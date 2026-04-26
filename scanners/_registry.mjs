// scanners/_registry.mjs
// Auto-discovers adapter modules under scanners/{api,rss,sitemap,ats,jsonld,scrape}.
// Each adapter exports:
//   export const meta    — AdapterMeta (id, kind, regions, supports, presets, schema)
//   export default async (config, ctx) => Job[]
//
// Nothing is hardcoded by role/region — all queries/locations/categories come from
// the orchestrator's per-source config block.

import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  RateLimiter,
  CircuitBreaker,
  pAllLimit,
  buildTitleFilter,
  canonicalUrl,
} from './_base.mjs';
import { normalizeRegionTokens } from './_normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KIND_DIRS = ['api', 'rss', 'sitemap', 'ats', 'jsonld', 'scrape'];

/** Discover and import every adapter under scanners/{kind}/*.mjs. */
export async function loadAdapters({ only = null } = {}) {
  const out = [];
  for (const kind of KIND_DIRS) {
    const dir = path.join(__dirname, kind);
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')); }
    catch { continue; }
    for (const f of files) {
      const id = f.replace(/\.mjs$/, '');
      if (only && !only.includes(id)) continue;
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      const meta = mod.meta || { id, kind };
      const fetchFn = mod.default;
      if (typeof fetchFn !== 'function') {
        throw new Error(`Adapter ${kind}/${f} missing default export`);
      }
      const envKeys = Array.isArray(meta.envKeys) ? meta.envKeys : [];
      const missingEnv = envKeys.filter((k) => !process.env[k]);
      const requiresKeySatisfied = !meta.requiresKey || missingEnv.length === 0;
      out.push({
        id: meta.id || id,
        kind: meta.kind || kind,
        meta,
        fetch: fetchFn,
        file: path.join(kind, f),
        envKeys,
        missingEnv,
        requiresKeySatisfied,
      });
    }
  }
  return out;
}

/**
 * Map the orchestrator's neutral query into adapter-shared field names so the
 * same shape works across every adapter. Adapters use these conventions:
 *   - `queries`     for free-text keywords
 *   - `locations`   for location filters
 *   - `companies`   for ATS slugs
 *   - `remote_only` for the remote toggle
 *
 * CLI overrides win when the user supplies them; otherwise the YAML config is
 * left untouched so adapter-specific knobs (e.g. `categories`, `affiliate_id`)
 * survive.
 */
export function queryToAdapterFields(query = {}) {
  const out = {};
  if (Array.isArray(query.titles) && query.titles.length) out.queries = query.titles;
  if (Array.isArray(query.locations) && query.locations.length) out.locations = query.locations;
  if (Array.isArray(query.companies) && query.companies.length) out.companies = query.companies;
  if (query.remote === true) out.remote_only = true;
  if (query.remote === false) out.remote_only = false;
  return out;
}

/**
 * Recursively replace `${VAR}` patterns inside any value with `process.env.VAR`.
 * Empty / undefined env vars resolve to ''. The original `portals.yml` shape
 * is preserved — only string leaves change.
 *
 * Why this exists: YAML doesn't interpolate env vars, so the literal string
 * `"${THE_MUSE_KEY}"` would otherwise reach the adapter and outshine the
 * adapter-side `process.env.THE_MUSE_KEY` fallback (because truthy literal
 * wins). One pass at the registry boundary fixes every keyed adapter.
 */
export function interpolateEnvVars(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(interpolateEnvVars);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateEnvVars(v);
    return out;
  }
  return value;
}

/** Returns true when the adapter's static region tags overlap the requested set. */
function adapterMatchesRegions(adapter, regions) {
  if (!regions || regions.length === 0) return true;
  const rawAdapterRegions = adapter.meta.regions || [];
  if (rawAdapterRegions.some((r) => String(r).toLowerCase() === 'worldwide')) return true;
  const adapterRegions = normalizeRegionTokens(rawAdapterRegions);
  if (adapterRegions.length === 0) return true; // adapter declares no regions; never filter out
  const want = new Set(normalizeRegionTokens(regions));
  return adapterRegions.some((r) => want.has(r));
}

/**
 * Run all adapters that are enabled in `config.sources`.
 * Returns { jobs, errors, stats, skipped }.
 *
 * Pre-flight rules:
 *   - Skip (with `info`) any adapter whose `enabled !== true` in YAML, unless
 *     `includeDisabled: true` is passed.
 *   - Skip (with `warn`) any adapter that declares `meta.envKeys` but is
 *     missing one or more from `process.env`.
 *   - When `query.regions` is provided, skip adapters whose static region tags
 *     do not overlap.
 *
 * Optional `query` (titles/locations/regions/companies/remote) is merged into
 * each adapter's per-source config before invocation. Use it to inject the
 * user's runtime search params without editing portals.yml.
 *
 * Optional `progress` callback receives per-adapter lifecycle events:
 *   { id, state: 'pending'|'running'|'ok'|'failed', fetched?, kept?, error?, ms? }
 * Used by the web-server to stream live status to a UI.
 */
export async function runAdapters({
  config,
  adapters,
  concurrency = 5,
  perAdapterTimeoutMs = 120_000,
  log = () => {},
  abortSignal,
  query = null,
  includeDisabled = false,
  progress = null,
}) {
  const sources = config.sources || {};
  const titleFilter = buildTitleFilter(config.title_filter);
  const rateLimiter = new RateLimiter({ minIntervalMs: 1500 });
  const breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 5 * 60_000 });

  const queryFields = queryToAdapterFields(query || {});
  const wantedRegions = Array.isArray(query?.regions) ? query.regions : [];

  const skipped = [];
  const enabled = adapters.filter((a) => {
    const cfg = sources[a.id];
    const isEnabled = cfg?.enabled === true || includeDisabled;
    if (!isEnabled) {
      skipped.push({ id: a.id, reason: 'disabled' });
      return false;
    }
    if (a.meta.unavailable === true) {
      const reason = a.meta.warning || 'adapter marked unavailable';
      log('warn', `${a.id} unavailable: ${reason}`);
      skipped.push({ id: a.id, reason: 'unavailable', detail: reason });
      return false;
    }
    if (a.missingEnv?.length) {
      log('warn', `${a.id} disabled — missing env: ${a.missingEnv.join(', ')}`);
      skipped.push({ id: a.id, reason: 'missing-env', missing: a.missingEnv });
      return false;
    }
    // Adapters declaring `requiresInputs: ['companies']` (every ATS) or
    // `['urls']` (the JSON-LD universal scraper) need at least one entry in
    // those array fields to do anything useful. Without inputs they used to
    // fire and silently return [] — confusing in the UI. Surface them as a
    // first-class skip with a clear reason instead.
    const requiresInputs = a.meta.requiresInputs;
    if (Array.isArray(requiresInputs) && requiresInputs.length) {
      const adapterCfg = sources[a.id] || {};
      const missingInputs = requiresInputs.filter((key) => {
        // Runtime overrides count too: if the user supplied --companies on
        // the CLI / via /api/scan/run, the adapter does have inputs.
        if (key === 'companies' && Array.isArray(queryFields.companies) && queryFields.companies.length) return false;
        const v = adapterCfg[key];
        return !Array.isArray(v) || v.length === 0;
      });
      if (missingInputs.length) {
        const detail = `Configure ${missingInputs.join(', ')} in portals.yml under "sources.${a.id}".`;
        skipped.push({ id: a.id, reason: 'no-inputs', missing: missingInputs, detail });
        return false;
      }
    }
    // requiresAck: name of a boolean opt-in flag (e.g. linkedin-guest's
    // `acknowledge_tos_risk`). When the flag is anything other than true,
    // skip the adapter entirely — running it would either no-op silently or
    // violate the upstream's ToS. Surfaces in the UI as a first-class skip.
    if (a.meta.requiresAck) {
      const ackKey = a.meta.requiresAck;
      const adapterCfg = sources[a.id] || {};
      if (adapterCfg[ackKey] !== true) {
        const detail = `Set ${ackKey}: true in portals.yml under "sources.${a.id}" to enable. ${a.meta.warning || ''}`.trim();
        skipped.push({ id: a.id, reason: 'needs-ack', ack: ackKey, detail });
        return false;
      }
    }
    if (!adapterMatchesRegions(a, wantedRegions)) {
      skipped.push({ id: a.id, reason: 'region-mismatch', adapterRegions: a.meta.regions || [], wantedRegions });
      return false;
    }
    return true;
  });

  log('info', `running ${enabled.length} of ${adapters.length} adapters`, {
    enabled: enabled.map((a) => a.id),
    skipped: skipped.map((s) => `${s.id}:${s.reason}`),
  });

  for (const a of enabled) progress?.({ id: a.id, state: 'pending' });

  const allJobs = [];
  const errors = [];
  const stats = [];

  const sinceDays = Number(query?.sinceDays) > 0 ? Number(query.sinceDays) : null;
  const sinceCutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : null;

  const results = await pAllLimit(enabled, concurrency, async (a) => {
    const baseCfg = interpolateEnvVars(sources[a.id] || {});
    // CLI / API query overrides win over YAML — but YAML keeps any
    // adapter-specific fields (categories, affiliate_id, etc.) intact.
    const adapterCfg = { ...baseCfg, ...queryFields };
    if (breaker.isOpen(a.id)) {
      log('warn', `circuit open, skipping ${a.id}`);
      progress?.({ id: a.id, state: 'failed', error: 'circuit-open' });
      return { id: a.id, jobs: [], skipped: true };
    }
    progress?.({ id: a.id, state: 'running' });
    const ctx = {
      rateLimiter,
      breaker,
      log: (level, msg, extra) => log(level, `[${a.id}] ${msg}`, extra),
      signal: abortSignal,
    };
    let timeoutId;
    const t0 = Date.now();
    try {
      const jobs = await Promise.race([
        a.fetch(adapterCfg, ctx),
        new Promise((_, rej) => {
          timeoutId = setTimeout(() => rej(new Error('adapter timeout')), perAdapterTimeoutMs);
        }),
      ]);
      breaker.recordSuccess(a.id);
      const rawJobs = (jobs || []).filter(Boolean);
      const validJobs = rawJobs.filter((j) => j.title && j.url);
      const invalid = rawJobs.length - validJobs.length;
      const stamped = validJobs.map((j) => ({
        ...j,
        source: j.source || a.id,
        source_kind: j.source_kind || a.kind,
        url: canonicalUrl(j.url),
      }));
      const titleFiltered = stamped.filter((j) => titleFilter(j.title));
      // Time-window filter: drop jobs older than `sinceDays` based on
      // posted_at / date_posted. Jobs without a parseable date pass — we
      // can't be sure they're stale, and many ATS feeds don't include one.
      const filtered = sinceCutoff != null
        ? titleFiltered.filter((j) => {
            const ts = Date.parse(j.posted_at || j.date_posted || j._scanned_at || '');
            return !ts || ts >= sinceCutoff;
          })
        : titleFiltered;
      const ms = Date.now() - t0;
      const tooOld = titleFiltered.length - filtered.length;
      log('info', `${a.id}: ${stamped.length} fetched, ${filtered.length} after filters` + (tooOld ? ` (${tooOld} too old)` : ''));
      stats.push({ id: a.id, fetched: stamped.length, kept: filtered.length, invalid, tooOld, ms });
      progress?.({ id: a.id, state: 'ok', fetched: stamped.length, kept: filtered.length, ms });
      return { id: a.id, jobs: filtered };
    } catch (err) {
      breaker.recordFailure(a.id);
      const e = { id: a.id, error: err?.message || String(err) };
      errors.push(e);
      const ms = Date.now() - t0;
      log('error', `${a.id} failed: ${e.error}`);
      stats.push({ id: a.id, fetched: 0, kept: 0, ms, error: e.error });
      progress?.({ id: a.id, state: 'failed', error: e.error, ms });
      return { id: a.id, jobs: [], error: e.error };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });

  for (const r of results) {
    if (r?.ok && r.value?.jobs) allJobs.push(...r.value.jobs);
  }

  return { jobs: allJobs, errors, stats, skipped };
}
