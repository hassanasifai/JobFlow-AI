import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadAdapters, runAdapters } from './_registry.mjs';
import { normalizeJob, jobMatchesRegions, normalizeRegionTokens, isUsOnly } from './_normalize.mjs';
import { isDuplicate, normalizeUrl } from './_dedupe.mjs';

export const CORE_FREE_PROVIDERS = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'recruitee',
  'smartrecruiters',
  'remoteok',
  'remotive',
  'arbeitnow',
  'personio',
];

export const OPTIONAL_PROVIDERS = ['adzuna', 'usajobs'];

const DEFAULT_DISCOVERY = {
  enabled: true,
  dry_run_default: false,
  max_concurrency: 5,
  request_timeout_ms: 20000,
  providers: {},
};

export function parseScanArgs(args = []) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export async function runGlobalScan({
  cwd = process.cwd(),
  config = null,
  adapters = null,
  argv = {},
  log = (level, msg) => process.stderr.write(`${level}: ${msg}\n`),
} = {}) {
  const portalsPath = path.join(cwd, 'portals.yml');
  const loadedConfig = config || loadConfig(portalsPath);
  const discovery = { ...DEFAULT_DISCOVERY, ...(loadedConfig.job_discovery || {}) };
  if (discovery.enabled === false) {
    return emptyResult({ dryRun: true, reason: 'job_discovery disabled' });
  }

  if (argv['no-cache']) process.env.CAREER_OPS_NO_CACHE = '1';
  const dryRun = argv['dry-run'] === true || (!argv['dry-run'] && discovery.dry_run_default === true);
  const requestedProviders = splitList(argv.provider);
  const requestedRegions = splitList(argv.region);
  const sinceDays = numberOrNull(argv['since-days']);
  const limit = numberOrNull(argv.limit);
  const concurrency = Number(argv.concurrency || discovery.max_concurrency || 5);
  const noOptional = argv['no-optional'] === true;

  const effectiveConfig = buildAdapterConfig(loadedConfig, {
    requestedProviders,
    allFree: argv['all-free'] === true,
    noOptional,
    companyFilter: argv.company || null,
  });
  effectiveConfig.title_filter = buildEffectiveTitleFilter(loadedConfig);

  const only = requestedProviders.length
    ? requestedProviders
    : (argv['all-free'] ? CORE_FREE_PROVIDERS : null);
  const adapterList = adapters || await loadAdapters({ only });
  const runnableAdapters = adapterList.filter((adapter) => {
    if (requestedProviders.length && !requestedProviders.includes(adapter.id)) return false;
    if (noOptional && OPTIONAL_PROVIDERS.includes(adapter.id)) return false;
    if (argv['all-free'] && !CORE_FREE_PROVIDERS.includes(adapter.id)) return false;
    return true;
  });

  const adapterResult = await runAdapters({
    config: effectiveConfig,
    adapters: runnableAdapters,
    concurrency,
    perAdapterTimeoutMs: discovery.adapter_timeout_ms || 120000,
    log,
    query: requestedRegions.length ? { regions: requestedRegions } : null,
    includeDisabled: argv['all-free'] === true || requestedProviders.length > 0,
  });

  const existing = loadExistingJobs(cwd);
  const accepted = [];
  const perProviderAccepted = new Map();
  let invalidSkipped = adapterResult.stats.reduce((sum, s) => sum + (s.invalid || 0), 0);
  let locationSkipped = 0;
  let sinceSkipped = 0;
  let duplicatesSkipped = 0;

  for (const rawJob of adapterResult.jobs) {
    const job = normalizeJob(rawJob);
    job.url = normalizeUrl(job.url);
    job.apply_url = normalizeUrl(job.apply_url || job.url) || null;
    if (!job.title || !job.url) {
      invalidSkipped++;
      continue;
    }
    if (sinceDays != null && job.date_posted && isOlderThan(job.date_posted, sinceDays)) {
      sinceSkipped++;
      continue;
    }
    if (!jobMatchesRegions(job, requestedRegions)) {
      locationSkipped++;
      continue;
    }
    if (requestedRegions.length && isUsOnly(job) && !normalizeRegionTokens(requestedRegions).includes('usa')) {
      locationSkipped++;
      continue;
    }
    if (isDuplicate(job, existing) || isDuplicate(job, accepted)) {
      duplicatesSkipped++;
      continue;
    }
    accepted.push(job);
    perProviderAccepted.set(job.source, (perProviderAccepted.get(job.source) || 0) + 1);
    if (limit && accepted.length >= limit) break;
  }

  if (!dryRun && accepted.length > 0) {
    persistJobs(cwd, accepted);
  }

  const providerResults = adapterResult.stats.map((s) => ({
    provider: s.id,
    fetched: s.fetched,
    accepted: perProviderAccepted.get(s.id) || 0,
    skipped: Math.max(0, s.fetched - (perProviderAccepted.get(s.id) || 0)),
    error: s.error || null,
  }));

  return {
    providersAttempted: adapterResult.stats.length,
    providersSucceeded: adapterResult.stats.filter((s) => !s.error).length,
    providersFailed: adapterResult.stats.filter((s) => s.error).length,
    rawJobsFetched: adapterResult.stats.reduce((sum, s) => sum + (s.fetched || 0), 0),
    afterTitleFilter: adapterResult.stats.reduce((sum, s) => sum + (s.kept || 0), 0),
    afterLocationFilter: accepted.length + duplicatesSkipped,
    duplicatesSkipped,
    invalidSkipped,
    locationSkipped,
    sinceSkipped,
    newJobsAdded: accepted.length,
    newJobs: accepted,
    providerResults,
    errors: adapterResult.errors,
    skipped: adapterResult.skipped,
    dryRun,
  };
}

export function printScanSummary(result, stream = process.stdout) {
  stream.write('Scan Summary\n');
  stream.write('------------\n');
  stream.write(`Providers attempted: ${result.providersAttempted}\n`);
  stream.write(`Providers succeeded: ${result.providersSucceeded}\n`);
  stream.write(`Providers failed: ${result.providersFailed}\n`);
  stream.write(`Raw jobs fetched: ${result.rawJobsFetched}\n`);
  stream.write(`After title filter: ${result.afterTitleFilter}\n`);
  stream.write(`After location/region filter: ${result.afterLocationFilter}\n`);
  stream.write(`Duplicates skipped: ${result.duplicatesSkipped}\n`);
  stream.write(`New jobs added: ${result.newJobsAdded}\n`);
  stream.write(`Dry run: ${result.dryRun ? 'true' : 'false'}\n\n`);
  stream.write('Provider Results\n');
  stream.write('----------------\n');
  for (const p of result.providerResults) {
    stream.write(`${p.provider}: fetched=${p.fetched} accepted=${p.accepted} skipped=${p.skipped}${p.error ? ` error=${p.error}` : ''}\n`);
  }
  if (result.newJobs.length > 0) {
    stream.write('\nNew jobs:\n');
    for (const job of result.newJobs.slice(0, 30)) {
      stream.write(`  + [${job.source}] ${job.company} | ${job.title} | ${job.location || job.region_group}\n`);
    }
  }
}

function loadConfig(portalsPath) {
  if (!existsSync(portalsPath)) throw new Error('portals.yml not found. Run onboarding first.');
  return yaml.load(readFileSync(portalsPath, 'utf-8')) || {};
}

function buildAdapterConfig(config, { requestedProviders = [], allFree = false, noOptional = false, companyFilter = null } = {}) {
  const discovery = { ...DEFAULT_DISCOVERY, ...(config.job_discovery || {}) };
  const sources = structuredClone(config.sources || {});
  const providers = discovery.providers || {};

  for (const id of [...CORE_FREE_PROVIDERS, ...OPTIONAL_PROVIDERS]) {
    sources[id] = { ...(sources[id] || {}), ...(providers[id] || {}) };
    if (providers[id]?.enabled != null) sources[id].enabled = providers[id].enabled;
  }

  addTrackedCompanies(sources, config.tracked_companies || [], companyFilter, { autodetectLegacy: !allFree });

  if (allFree) {
    for (const id of CORE_FREE_PROVIDERS) sources[id] = { ...(sources[id] || {}), enabled: true };
  }
  for (const id of requestedProviders) sources[id] = { ...(sources[id] || {}), enabled: true };
  if (noOptional) {
    for (const id of OPTIONAL_PROVIDERS) sources[id] = { ...(sources[id] || {}), enabled: false };
  }

  return { ...config, sources };
}

function addTrackedCompanies(sources, companies, companyFilter, { autodetectLegacy = true } = {}) {
  for (const company of companies) {
    if (company.enabled === false) continue;
    if (companyFilter && !String(company.name || '').toLowerCase().includes(String(companyFilter).toLowerCase())) continue;
    const ats = company.ats || (autodetectLegacy ? detectAts(company) : null);
    if (!ats?.provider) continue;
    const provider = ats.provider;
    const slug = ats.board_token || ats.account || ats.board || ats.subdomain || ats.company_id || ats.company_identifier || ats.company_slug;
    if (!slug) continue;
    sources[provider] = { ...(sources[provider] || {}), enabled: sources[provider]?.enabled !== false };
    const companiesList = new Set(sources[provider].companies || []);
    companiesList.add(slug);
    sources[provider].companies = [...companiesList];
  }
}

function detectAts(company) {
  if (company.api && /greenhouse/i.test(company.api)) {
    const token = String(company.api).match(/\/boards\/([^/]+)\/jobs/)?.[1];
    if (token) return { provider: 'greenhouse', board_token: token };
  }
  const url = company.careers_url || '';
  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i)?.[1];
  if (ashby) return { provider: 'ashby', board: ashby };
  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/i)?.[1];
  if (lever) return { provider: 'lever', account: lever };
  const greenhouse = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i)?.[1]
    || url.match(/boards\.greenhouse\.io\/([^/?#]+)/i)?.[1];
  if (greenhouse) return { provider: 'greenhouse', board_token: greenhouse };
  const workable = url.match(/apply\.workable\.com\/([^/?#]+)/i)?.[1];
  if (workable) return { provider: 'workable', subdomain: workable };
  return null;
}

function buildEffectiveTitleFilter(config) {
  const discoveryFilter = config.job_discovery?.title_filter;
  if (!discoveryFilter) return config.title_filter || {};
  return {
    positive: discoveryFilter.include || discoveryFilter.positive || [],
    negative: discoveryFilter.exclude || discoveryFilter.negative || [],
  };
}

function loadExistingJobs(cwd) {
  const dataDir = path.join(cwd, 'data');
  const jobs = [];
  const jsonl = path.join(dataDir, 'jobs.jsonl');
  if (existsSync(jsonl)) {
    for (const line of readFileSync(jsonl, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { jobs.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  for (const file of ['scan-history.tsv', 'pipeline.md', 'applications.md']) {
    const p = path.join(dataDir, file);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf-8');
    for (const m of text.matchAll(/https?:\/\/[^\s|)]+/g)) jobs.push({ url: m[0] });
  }
  return jobs;
}

function persistJobs(cwd, jobs) {
  const dataDir = path.join(cwd, 'data');
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(path.join(dataDir, 'jobs.jsonl'), jobs.map((j) => JSON.stringify({ ...j, _scanned_at: new Date().toISOString() })).join('\n') + '\n', 'utf-8');
  appendScanHistory(path.join(dataDir, 'scan-history.tsv'), jobs);
  appendPipeline(path.join(dataDir, 'pipeline.md'), jobs);
}

function appendScanHistory(file, jobs) {
  if (!existsSync(file)) writeFileSync(file, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  const date = new Date().toISOString().slice(0, 10);
  const lines = jobs.map((j) => `${j.url}\t${date}\t${j.source}\t${escapeTsv(j.title)}\t${escapeTsv(j.company)}\tadded`).join('\n') + '\n';
  appendFileSync(file, lines, 'utf-8');
}

function appendPipeline(file, jobs) {
  let text = existsSync(file) ? readFileSync(file, 'utf-8') : '# career-ops pipeline\n\n## Pendientes\n\n';
  const block = jobs.map((j) => [
    `- [ ] ${j.url} | ${escapeMd(j.company)} | ${escapeMd(j.title)}`,
    `  - Source: ${escapeMd(j.source)}`,
    `  - Location: ${escapeMd(j.location || 'N/A')}`,
    `  - Region: ${escapeMd(j.region_group || 'other')}`,
    `  - Remote: ${j.remote ? 'yes' : 'no'}`,
    `  - Posted: ${escapeMd(j.date_posted || 'unknown')}`,
  ].join('\n')).join('\n');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    text += `\n${marker}\n\n${block}\n`;
  } else {
    const insertAt = (() => {
      const after = idx + marker.length;
      const next = text.indexOf('\n## ', after);
      return next === -1 ? text.length : next;
    })();
    text = text.slice(0, insertAt) + '\n' + block + '\n' + text.slice(insertAt);
  }
  writeFileSync(file, text, 'utf-8');
}

function emptyResult({ dryRun, reason }) {
  return {
    providersAttempted: 0,
    providersSucceeded: 0,
    providersFailed: 0,
    rawJobsFetched: 0,
    afterTitleFilter: 0,
    afterLocationFilter: 0,
    duplicatesSkipped: 0,
    invalidSkipped: 0,
    locationSkipped: 0,
    sinceSkipped: 0,
    newJobsAdded: 0,
    newJobs: [],
    providerResults: [],
    errors: reason ? [{ id: 'job_discovery', error: reason }] : [],
    skipped: [],
    dryRun,
  };
}

function splitList(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function numberOrNull(value) {
  if (value == null || value === true) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isOlderThan(date, days) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > days * 24 * 60 * 60 * 1000;
}

function escapeTsv(value) {
  return String(value || '').replace(/[\t\r\n]/g, ' ');
}

function escapeMd(value) {
  return String(value || '').replace(/[\r\n|]/g, ' ').trim();
}
