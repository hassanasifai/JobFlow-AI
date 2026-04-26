#!/usr/bin/env node
// scan-v2.mjs — Multi-source job scanner orchestrator
//
// Loads every adapter under scanners/{api,rss,sitemap,ats,jsonld,scrape}/,
// reads enabled sources from portals.yml, runs them in parallel with rate
// limiting + circuit breaker, dedupes globally, and persists to:
//   - data/jobs.jsonl       (canonical, append-only)
//   - data/pipeline.md      (back-compat with existing CLI/web/dashboard)
//   - data/scan-history.tsv (back-compat with original scan.mjs)
//
// CLI:
//   node scan-v2.mjs                       # run all enabled sources
//   node scan-v2.mjs --dry-run             # do not write any files
//   node scan-v2.mjs --source remotive     # run only one source
//   node scan-v2.mjs --source remotive,mustakbil
//   node scan-v2.mjs --list-sources        # JSON list of every adapter + its meta
//   node scan-v2.mjs --list-options <id>   # JSON of one adapter's preset options
//   node scan-v2.mjs --init-sources        # append default `sources:` block to portals.yml
//   node scan-v2.mjs --json                # emit final summary as JSON
//   node scan-v2.mjs --concurrency 5       # parallel adapter limit
//   node scan-v2.mjs --quiet               # silence per-adapter logs
//
// Runtime query overrides (frontend will pass these later; CLI for now):
//   --titles "Senior Backend, AI Engineer"   # comma-separated
//   --regions "pakistan,gulf,worldwide-remote"
//   --locations "Lahore, Dubai, Remote"
//   --remote true|false                       # toggles remote_only on supporting adapters
//   --companies "careem, talabat"             # ATS slugs
//   --include-disabled                        # ignore enabled:false in YAML
//
// Nothing is hardcoded by role/region — all queries/keywords/locations come
// from portals.yml or the CLI flags above. The future SaaS frontend will pass
// the same shape via HTTP.

import 'dotenv/config';
import { readFileSync, existsSync, appendFileSync } from 'fs';
import yaml from 'js-yaml';
import { loadAdapters, runAdapters } from './scanners/_registry.mjs';
import { canonicalUrl } from './scanners/_base.mjs';
import {
  loadSeenUrls,
  loadSeenCompanyRoles,
  appendJsonl,
  appendScanHistory,
  appendPipeline,
} from './scanners/_writer.mjs';

const PORTALS_PATH = 'portals.yml';
const PORTALS_TEMPLATE_PATH = 'templates/portals.example.yml';

// ── Argv parsing ───────────────────────────────────────────────────

const argv = parseArgs(process.argv.slice(2));

// ── --init-sources: append the example sources: block to portals.yml ──

if (argv['init-sources']) {
  initSources();
  process.exit(0);
}

// ── Load adapters early (used by --list flags) ─────────────────────

const adapters = await loadAdapters({
  only: argv.source ? argv.source.split(',').map((s) => s.trim()).filter(Boolean) : null,
});

// ── Introspection commands (no scanning) ──────────────────────────

if (argv['list-sources']) {
  const out = adapters.map((a) => ({
    id: a.id,
    kind: a.kind,
    file: a.file,
    regions: a.meta.regions || [],
    requiresKey: !!a.meta.requiresKey,
    requiresKeySatisfied: a.requiresKeySatisfied,
    envKeys: a.envKeys || [],
    missingEnv: a.missingEnv || [],
    supports: a.meta.supports || {},
    presets: a.meta.presets || {},
    schema: a.meta.schema || {},
    docs: a.meta.docs || null,
    warning: a.meta.warning || null,
  }));
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (argv['list-options']) {
  const id = argv['list-options'];
  const a = adapters.find((x) => x.id === id);
  if (!a) {
    process.stderr.write(`unknown source: ${id}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({
    id: a.id,
    kind: a.kind,
    regions: a.meta.regions || [],
    supports: a.meta.supports || {},
    presets: a.meta.presets || {},
    schema: a.meta.schema || {},
    docs: a.meta.docs || null,
    requiresKey: !!a.meta.requiresKey,
    requiresKeySatisfied: a.requiresKeySatisfied,
    envKeys: a.envKeys || [],
    missingEnv: a.missingEnv || [],
    warning: a.meta.warning || null,
  }, null, 2) + '\n');
  process.exit(0);
}

// ── Load config ────────────────────────────────────────────────────

if (!existsSync(PORTALS_PATH)) {
  process.stderr.write(`Error: ${PORTALS_PATH} not found. Copy templates/portals.example.yml first.\n`);
  process.exit(1);
}
const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};

// ── Logging ────────────────────────────────────────────────────────

const log = (level, msg, extra) => {
  if (argv.quiet && level === 'info') return;
  const prefix = level === 'error' ? '✗' : (level === 'warn' ? '⚠' : '·');
  process.stderr.write(`${prefix} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`);
};

// ── Build runtime query from CLI flags ─────────────────────────────

const query = buildQueryFromArgv(argv);

// ── Run ────────────────────────────────────────────────────────────

const t0 = Date.now();
const concurrency = Number(argv.concurrency) || 5;

const { jobs, errors, stats, skipped } = await runAdapters({
  config,
  adapters,
  concurrency,
  log,
  query,
  includeDisabled: !!argv['include-disabled'],
});

// ── Global dedup: vs already-seen URLs and (company, role) pairs ──

const seenUrls = loadSeenUrls();
const seenCompanyRoles = loadSeenCompanyRoles();

const fresh = [];
const intra = new Set();
let dupUrl = 0, dupRole = 0;
for (const j of jobs) {
  const url = canonicalUrl(j.url);
  if (!url) continue;
  if (seenUrls.has(url) || intra.has(url)) { dupUrl++; continue; }
  intra.add(url);
  const key = `${(j.company || '').toLowerCase()}::${(j.title || '').toLowerCase()}`;
  if (seenCompanyRoles.has(key)) { dupRole++; continue; }
  seenCompanyRoles.add(key);
  fresh.push({ ...j, url });
}

// ── Persist ────────────────────────────────────────────────────────

if (!argv['dry-run'] && fresh.length > 0) {
  appendJsonl(fresh);
  appendScanHistory(fresh);
  appendPipeline(fresh);
}

// ── Summary ────────────────────────────────────────────────────────

const summary = {
  scanned_at: new Date().toISOString(),
  duration_ms: Date.now() - t0,
  adapters: stats,
  fetched: jobs.length,
  duplicates_url: dupUrl,
  duplicates_role: dupRole,
  new_jobs: fresh.length,
  errors,
  skipped: skipped || [],
  query,
  dry_run: !!argv['dry-run'],
};

if (argv.json) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  printHumanSummary(summary, fresh);
}

process.exit(errors.length > 0 && fresh.length === 0 ? 1 : 0);

// ── Helpers ───────────────────────────────────────────────────────

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { out[k] = next; i++; }
    else out[k] = true;
  }
  return out;
}

function splitList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildQueryFromArgv(a) {
  const q = {};
  const titles = splitList(a.titles);
  if (titles.length) q.titles = titles;
  const regions = splitList(a.regions);
  if (regions.length) q.regions = regions;
  const locations = splitList(a.locations);
  if (locations.length) q.locations = locations;
  const companies = splitList(a.companies);
  if (companies.length) q.companies = companies;
  if (a.remote === 'true') q.remote = true;
  else if (a.remote === 'false') q.remote = false;
  return q;
}

/**
 * Append the default `sources:` block from templates/portals.example.yml to
 * the user's portals.yml, so scan-v2 has something to read. Idempotent: if a
 * `sources:` line already exists, we report and exit. Never overwrites
 * existing content.
 */
function initSources() {
  if (!existsSync(PORTALS_PATH)) {
    process.stderr.write(`Error: ${PORTALS_PATH} not found. Copy ${PORTALS_TEMPLATE_PATH} first.\n`);
    process.exit(1);
  }
  if (!existsSync(PORTALS_TEMPLATE_PATH)) {
    process.stderr.write(`Error: ${PORTALS_TEMPLATE_PATH} not found.\n`);
    process.exit(1);
  }
  const current = readFileSync(PORTALS_PATH, 'utf-8');
  if (/^sources:\s*$/m.test(current)) {
    process.stdout.write(`portals.yml already has a "sources:" block — nothing to do.\n`);
    return;
  }
  const template = readFileSync(PORTALS_TEMPLATE_PATH, 'utf-8');
  const idx = template.indexOf('\nsources:');
  if (idx === -1) {
    process.stderr.write(`Error: ${PORTALS_TEMPLATE_PATH} has no sources: block.\n`);
    process.exit(1);
  }
  const block = template.slice(idx);
  const sep = current.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(PORTALS_PATH, sep + block, 'utf-8');
  const lines = block.match(/^  ([a-z0-9-]+):\s*$/gm) || [];
  process.stdout.write(
    `Appended sources: block to ${PORTALS_PATH} (${lines.length} adapters configured).\n` +
    `Open the file and set "enabled: true" / fill query fields for the sources you want.\n`,
  );
}

function printHumanSummary(s, fresh) {
  const bar = '─'.repeat(50);
  process.stderr.write(`\n${bar}\n`);
  process.stderr.write(`Scan v2 — ${s.scanned_at} (${(s.duration_ms / 1000).toFixed(1)}s)\n`);
  process.stderr.write(`${bar}\n`);
  for (const a of s.adapters) {
    const note = a.error ? ` ✗ ${a.error}` : '';
    process.stderr.write(`  ${a.id.padEnd(22)} fetched=${String(a.fetched).padStart(5)} kept=${String(a.kept).padStart(5)} (${a.ms}ms)${note}\n`);
  }
  process.stderr.write(`${bar}\n`);
  process.stderr.write(`Total fetched:    ${s.fetched}\n`);
  process.stderr.write(`Duplicates (URL): ${s.duplicates_url}\n`);
  process.stderr.write(`Duplicates (role): ${s.duplicates_role}\n`);
  process.stderr.write(`New jobs:         ${s.new_jobs}\n`);
  if (s.dry_run) process.stderr.write(`(dry-run — files NOT written)\n`);
  if (s.errors?.length) process.stderr.write(`Errors: ${s.errors.length}\n`);
  if (s.skipped?.length) {
    const grouped = {};
    for (const k of s.skipped) (grouped[k.reason] = grouped[k.reason] || []).push(k.id);
    for (const [reason, ids] of Object.entries(grouped)) {
      process.stderr.write(`Skipped (${reason}): ${ids.join(', ')}\n`);
    }
  }
  if (fresh.length > 0 && fresh.length <= 30) {
    process.stderr.write(`\nSample:\n`);
    for (const j of fresh.slice(0, 30)) {
      process.stderr.write(`  + [${j.source}] ${j.company} | ${j.title} | ${j.location || j.region.join(',') || 'n/a'}\n`);
    }
  }
}
