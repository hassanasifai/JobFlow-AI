#!/usr/bin/env node
// scripts/probe-sources.mjs — Live-test every adapter against real endpoints.
//
// Runs ALL adapters (including disabled ones) so we can:
//   • prove every "enabled: true" source is fetching jobs
//   • capture a sample title + URL per source so the Sources page can show
//     proof-of-life even when no scan has been run yet
//   • surface skip-reasons (unavailable, missing-env, no-inputs) per source
//   • write data/source-health.json so the dashboard can read it
//
// CLI:
//   node scripts/probe-sources.mjs                     # print human table
//   node scripts/probe-sources.mjs --json              # emit JSON to stdout
//   node scripts/probe-sources.mjs --only remoteok     # one source
//   node scripts/probe-sources.mjs --skip-write        # don't write the JSON snapshot
//   node scripts/probe-sources.mjs --concurrency 3
//
// Exit codes:
//   0  — every enabled adapter either returned ≥1 job, or has a documented skip
//   1  — one or more enabled adapters errored without a skip-reason
//   2  — argv parse error / portals.yml missing

import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadAdapters, runAdapters } from '../scanners/_registry.mjs';

const PORTALS_PATH = 'portals.yml';
const HEALTH_PATH = 'data/source-health.json';

const argv = parseArgs(process.argv.slice(2));

if (!existsSync(PORTALS_PATH)) {
  process.stderr.write(`Error: ${PORTALS_PATH} not found. Run from repo root.\n`);
  process.exit(2);
}

const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
const onlyList = argv.only ? splitList(argv.only) : null;
const concurrency = Math.max(1, Math.min(20, Number(argv.concurrency) || 4));

const adapters = await loadAdapters({ only: onlyList });
if (adapters.length === 0) {
  process.stderr.write(`No adapters loaded${onlyList ? ` (filter: ${onlyList.join(',')})` : ''}.\n`);
  process.exit(2);
}

// Capture full job samples per adapter as runAdapters reports its stats.
// runAdapters' progress callback runs at lifecycle events but only carries
// counts. We need actual sample jobs, so we wrap the adapter fetch fns.
const samples = new Map();   // id → first valid job or null
const wrapped = adapters.map((a) => {
  const inner = a.fetch;
  return {
    ...a,
    fetch: async (cfg, ctx) => {
      const jobs = await inner(cfg, ctx);
      if (Array.isArray(jobs)) {
        const first = jobs.find((j) => j && j.title && j.url);
        if (first) {
          samples.set(a.id, {
            title: String(first.title).slice(0, 200),
            url: String(first.url).slice(0, 500),
            company: first.company ? String(first.company).slice(0, 200) : null,
            location: first.location ? String(first.location).slice(0, 200) : null,
            posted_at: first.posted_at || first.date_posted || null,
          });
        }
      }
      return jobs;
    },
  };
});

const t0 = Date.now();
const log = argv.quiet
  ? () => {}
  : (level, msg) => {
      const prefix = level === 'error' ? '✗' : (level === 'warn' ? '⚠' : '·');
      process.stderr.write(`${prefix} ${msg}\n`);
    };

const { stats, skipped } = await runAdapters({
  config,
  adapters: wrapped,
  concurrency,
  log,
  includeDisabled: true,
  perAdapterTimeoutMs: 60_000,
});
const totalMs = Date.now() - t0;

// Build the per-adapter health row. Status priority (highest wins):
//   error → unavailable → missing-env → no-inputs → disabled → ok-fetched →
//   ok-empty (ran but returned 0 — likely a real bug to investigate)
const rows = [];
for (const a of adapters) {
  const stat = stats.find((s) => s.id === a.id);
  const skip = skipped.find((s) => s.id === a.id);
  const enabledInYaml = (config.sources?.[a.id]?.enabled === true);
  const sample = samples.get(a.id) || null;
  let status, detail;

  if (stat?.error) {
    status = 'error'; detail = stat.error;
  } else if (skip) {
    status = skip.reason; detail = skip.detail || (skip.missing ? `missing: ${skip.missing.join(', ')}` : '');
  } else if (stat && stat.fetched > 0) {
    status = 'ok'; detail = `fetched ${stat.fetched}, kept ${stat.kept}`;
  } else if (stat) {
    status = 'empty'; detail = 'ran, returned 0 jobs (investigate)';
  } else {
    status = 'unknown'; detail = 'did not run';
  }

  rows.push({
    id: a.id,
    kind: a.kind,
    enabled: enabledInYaml,
    requiresKey: !!a.meta.requiresKey,
    requiresKeySatisfied: a.requiresKeySatisfied,
    requiresInputs: a.meta.requiresInputs || null,
    unavailable: !!a.meta.unavailable,
    regions: a.meta.regions || [],
    fetched: stat?.fetched ?? 0,
    kept: stat?.kept ?? 0,
    invalid: stat?.invalid ?? 0,
    too_old: stat?.tooOld ?? 0,
    ms: stat?.ms ?? 0,
    status,
    detail,
    sample,
    signupUrl: a.meta.signupUrl || null,
    freeTier: a.meta.freeTier || null,
  });
}

const health = {
  probed_at: new Date().toISOString(),
  duration_ms: totalMs,
  total: rows.length,
  ok: rows.filter((r) => r.status === 'ok').length,
  empty: rows.filter((r) => r.status === 'empty').length,
  errored: rows.filter((r) => r.status === 'error').length,
  skipped: rows.filter((r) => ['unavailable', 'missing-env', 'no-inputs', 'needs-ack', 'disabled', 'region-mismatch'].includes(r.status)).length,
  sources: rows.sort((a, b) => a.id.localeCompare(b.id)),
};

if (!argv['skip-write']) {
  const dir = path.dirname(HEALTH_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2) + '\n');
}

if (argv.json) {
  process.stdout.write(JSON.stringify(health, null, 2) + '\n');
} else {
  printTable(rows, totalMs);
}

// Fail the run only on real regressions: a source that's enabled in YAML AND
// errored / returned 0 jobs without a documented skip-reason. The "empty"
// status is still informational — could be no jobs match the filter today.
const regressions = rows.filter((r) =>
  r.enabled && (r.status === 'error' || (r.status === 'empty' && !r.unavailable && !r.requiresKey)),
);
process.exit(regressions.length > 0 ? 1 : 0);

// ── helpers ────────────────────────────────────────────────────────────

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

function splitList(v) {
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function pad(s, w) { s = String(s ?? ''); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); }

function printTable(rows, ms) {
  const widths = { id: 22, kind: 8, status: 14, fetched: 7, kept: 6, ms: 6, detail: 50 };
  const sep = '─'.repeat(115);
  process.stderr.write(`\n${sep}\nProbe summary (${(ms / 1000).toFixed(1)}s, ${rows.length} adapters)\n${sep}\n`);
  process.stderr.write(
    pad('id', widths.id) + pad('kind', widths.kind) + pad('status', widths.status) +
    pad('fetched', widths.fetched) + pad('kept', widths.kept) + pad('ms', widths.ms) + 'detail\n',
  );
  process.stderr.write(sep + '\n');
  const sorted = [...rows].sort((a, b) => {
    const order = { error: 0, empty: 1, ok: 2, 'no-inputs': 3, 'needs-ack': 4, 'missing-env': 5, unavailable: 6, disabled: 7, 'region-mismatch': 8, unknown: 9 };
    return (order[a.status] ?? 10) - (order[b.status] ?? 10) || a.id.localeCompare(b.id);
  });
  for (const r of sorted) {
    const mark =
      r.status === 'ok' ? '✓ ok         ' :
      r.status === 'error' ? '✗ error      ' :
      r.status === 'empty' ? '∅ empty      ' :
      r.status === 'unavailable' ? '⊘ unavailable' :
      r.status === 'missing-env' ? '⚿ needs-env  ' :
      r.status === 'no-inputs' ? '⚙ needs-cfg  ' :
      r.status === 'needs-ack' ? '⚠ needs-ack  ' :
      r.status === 'disabled' ? '· disabled   ' :
      r.status === 'region-mismatch' ? '↯ region-skip' :
                              '? unknown    ';
    process.stderr.write(
      pad(r.id, widths.id) + pad(r.kind, widths.kind) + pad(mark, widths.status) +
      pad(r.fetched, widths.fetched) + pad(r.kept, widths.kept) + pad(r.ms, widths.ms) +
      String(r.detail || '').slice(0, widths.detail) + '\n',
    );
  }
  process.stderr.write(sep + '\n');
  const ok = rows.filter((r) => r.status === 'ok').length;
  const empty = rows.filter((r) => r.status === 'empty').length;
  const errored = rows.filter((r) => r.status === 'error').length;
  process.stderr.write(`Summary: ${ok} ok · ${empty} empty · ${errored} errored · ${rows.length - ok - empty - errored} skipped\n`);
}
