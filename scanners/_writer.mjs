// scanners/_writer.mjs
// Persistence layer for scanner output. Writes to THREE places:
//   1. data/jobs.jsonl       — append-only normalized JSON (Postgres-ready)
//   2. data/pipeline.md      — markdown checklist (back-compat with existing CLI/web)
//   3. data/scan-history.tsv — flat dedup history (back-compat with scan.mjs)
//
// All three formats coexist; the JSONL is the canonical record. The MD/TSV files
// are mirrors for the existing dashboard, web-server, and pipeline modes.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { canonicalUrl } from './_base.mjs';

const DATA_DIR = 'data';
const JSONL_PATH = path.join(DATA_DIR, 'jobs.jsonl');
const PIPELINE_PATH = path.join(DATA_DIR, 'pipeline.md');
const SCAN_HISTORY_PATH = path.join(DATA_DIR, 'scan-history.tsv');
const APPLICATIONS_PATH = path.join(DATA_DIR, 'applications.md');

const TSV_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n';
const PIPELINE_MARKER = '## Pendientes';
const PIPELINE_PROCESSED = '## Procesadas';

mkdirSync(DATA_DIR, { recursive: true });

// ── Dedup loaders ─────────────────────────────────────────────────

/**
 * Returns a Set of canonical URLs already known to the system.
 * Reads from jobs.jsonl + pipeline.md + applications.md + scan-history.tsv.
 */
export function loadSeenUrls() {
  const seen = new Set();

  if (existsSync(JSONL_PATH)) {
    const text = readFileSync(JSONL_PATH, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.url) seen.add(canonicalUrl(j.url));
      } catch { /* skip malformed line */ }
    }
  }

  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(canonicalUrl(url));
    }
  }

  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const m of text.matchAll(/- \[[ xX]\] (https?:\/\/\S+)/g)) seen.add(canonicalUrl(m[1]));
  }

  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/https?:\/\/[^\s|)]+/g)) seen.add(canonicalUrl(m[0]));
  }

  return seen;
}

/** Load (company, role) pairs already in applications.md to dedup re-postings. */
export function loadSeenCompanyRoles() {
  const seen = new Set();
  if (!existsSync(APPLICATIONS_PATH)) return seen;
  const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  for (const m of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
    const company = m[1].trim().toLowerCase();
    const role = m[2].trim().toLowerCase();
    if (company && role && company !== 'company') seen.add(`${company}::${role}`);
  }
  return seen;
}

// ── Writers ────────────────────────────────────────────────────────

/** Append jobs to data/jobs.jsonl, one JSON object per line. */
export function appendJsonl(jobs) {
  if (!jobs || jobs.length === 0) return;
  const lines = jobs.map((j) => JSON.stringify({ ...j, _scanned_at: new Date().toISOString() })).join('\n') + '\n';
  appendFileSync(JSONL_PATH, lines, 'utf-8');
}

/** Append jobs to data/scan-history.tsv (TSV format used by existing scan.mjs). */
export function appendScanHistory(jobs, date = new Date().toISOString().slice(0, 10)) {
  if (!jobs || jobs.length === 0) return;
  if (!existsSync(SCAN_HISTORY_PATH)) writeFileSync(SCAN_HISTORY_PATH, TSV_HEADER, 'utf-8');
  const lines = jobs.map((j) =>
    `${j.url}\t${date}\t${j.source}\t${escapeTsv(j.title)}\t${escapeTsv(j.company)}\tadded`
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

function escapeTsv(s) {
  return String(s || '').replace(/[\t\r\n]/g, ' ');
}

/**
 * Append jobs to data/pipeline.md as `- [ ] {url} | {company} | {title}` lines
 * under the `## Pendientes` section. Creates the section if missing.
 */
export function appendPipeline(jobs) {
  if (!jobs || jobs.length === 0) return;

  let text = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf-8') : '';
  const block = jobs.map((j) =>
    `- [ ] ${j.url} | ${escapeMd(j.company)} | ${escapeMd(j.title)}`
  ).join('\n');

  const idx = text.indexOf(PIPELINE_MARKER);
  if (idx === -1) {
    const procIdx = text.indexOf(PIPELINE_PROCESSED);
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const sep = text && !text.endsWith('\n') ? '\n' : '';
    const newSection = `${sep}${PIPELINE_MARKER}\n\n${block}\n\n`;
    text = text.slice(0, insertAt) + newSection + text.slice(insertAt);
  } else {
    const afterMarker = idx + PIPELINE_MARKER.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    text = text.slice(0, insertAt) + '\n' + block + '\n' + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function escapeMd(s) {
  return String(s || '').replace(/[\r\n|]/g, ' ').trim();
}

/** Convenience: write all three formats in one call. */
export function persistAll(jobs) {
  appendJsonl(jobs);
  appendScanHistory(jobs);
  appendPipeline(jobs);
}
