#!/usr/bin/env node

import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
import { discoverProviders, getProvider, defaultProvider } from './scanners/agents/registry.mjs';
import {
  resolveModeFile,
  readContextBundle,
  composeSystemPrompt,
  composeJdMessage,
  parseScoreSummary,
  stripScoreSummary,
  saveReport,
} from './scanners/agents/_prompt.mjs';
import { ProviderError } from './scanners/agents/_base.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const WEB_DIR = join(PROJECT_ROOT, 'web');
const DATA_DIR = join(PROJECT_ROOT, 'data');
const REPORTS_DIR = join(PROJECT_ROOT, 'reports');
const OUTPUT_DIR = join(PROJECT_ROOT, 'output');

const STATUS_OPTIONS = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];
const EDITABLE_FILES = new Set([
  'cv.md',
  'config/profile.yml',
  'portals.yml',
  'data/pipeline.md',
  'data/applications.md',
  'interview-prep/story-bank.md',
  'modes/_profile.md',
  'article-digest.md',
]);

const COMMANDS = Object.freeze({
  verify: {
    label: 'Run health check',
    description: 'Validate tracker rows, statuses, reports, and pending merges.',
    command: 'node',
    args: ['verify-pipeline.mjs'],
  },
  doctor: {
    label: 'Run setup check',
    description: 'Check Node, Playwright, CV, profile, portals, and folders.',
    command: 'node',
    args: ['doctor.mjs'],
  },
  scan: {
    label: 'Scan portals',
    description: 'Fetch ATS APIs and add matching offers to pipeline.',
    command: 'node',
    args: ['scan.mjs'],
  },
  syncCheck: {
    label: 'CV sync check',
    description: 'Validate profile/CV consistency and stale profile data.',
    command: 'node',
    args: ['cv-sync-check.mjs'],
  },
  normalize: {
    label: 'Normalize statuses',
    description: 'Convert tracker statuses into canonical state labels.',
    command: 'node',
    args: ['normalize-statuses.mjs'],
  },
  dedup: {
    label: 'Deduplicate tracker',
    description: 'Remove duplicate company-role rows from tracker.',
    command: 'node',
    args: ['dedup-tracker.mjs'],
  },
  merge: {
    label: 'Merge batch tracker',
    description: 'Merge batch TSV outputs into data/applications.md.',
    command: 'node',
    args: ['merge-tracker.mjs'],
  },
  analyzePatterns: {
    label: 'Analyze patterns',
    description: 'Summarize rejection/acceptance patterns from tracker and reports.',
    command: 'node',
    args: ['analyze-patterns.mjs', '--summary'],
  },
  followupCadence: {
    label: 'Follow-up cadence',
    description: 'Calculate follow-up urgency from tracker and follow-ups.',
    command: 'node',
    args: ['followup-cadence.mjs', '--summary'],
  },
  updateCheck: {
    label: 'Check updates',
    description: 'Check if upstream version is newer than local version.',
    command: 'node',
    args: ['update-system.mjs', 'check'],
  },
  updateApply: {
    label: 'Apply update',
    description: 'Apply upstream system-layer updates with backup branch.',
    command: 'node',
    args: ['update-system.mjs', 'apply'],
  },
  updateRollback: {
    label: 'Rollback update',
    description: 'Restore the latest backup branch state.',
    command: 'node',
    args: ['update-system.mjs', 'rollback'],
  },
});

const MAX_JSON_BODY = 256 * 1024;
const MAX_EDITABLE_CONTENT = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_MAX_BUFFER = 3 * 1024 * 1024;

const API_METHODS = {
  '/api/overview': ['GET'],
  '/api/report': ['GET'],
  '/api/config': ['GET', 'POST'],
  '/api/status': ['POST'],
  '/api/notes': ['POST'],
  '/api/pipeline/add': ['POST'],
  '/api/pipeline/toggle': ['POST'],
  '/api/pipeline/remove': ['POST'],
  '/api/command': ['POST'],
  '/api/liveness': ['POST'],
  '/api/gemini-eval': ['POST'],
  // Scanner endpoints — list adapters, kick off a scan with user-supplied query,
  // poll progress, fetch results. Designed for the future SaaS frontend.
  '/api/scanners': ['GET'],
  '/api/scan/run': ['POST'],
  // /api/scan/status/:id and /api/scan/results/:id are matched by prefix below.
  // Phase H — UI-facing read endpoints + saved searches.
  '/api/jobs': ['GET'],
  '/api/sources/health': ['GET'],
  '/api/sources/probe': ['POST'],
  '/api/saved-searches': ['GET', 'POST'],
  '/api/applications': ['POST'],
  '/api/agents': ['GET'],
  '/api/evaluate': ['POST'],
  '/api/generate-pdf': ['POST'],
  '/api/draft-application': ['POST'],
  '/api/deep-research': ['POST'],
  '/api/contacto': ['POST'],
  '/api/generate-cv': ['POST'],
  '/api/eval-training': ['POST'],
  '/api/eval-project': ['POST'],
  '/api/interview-prep': ['POST'],
  '/api/draft-followup': ['POST'],
  '/api/compare-offers': ['POST'],
  '/api/jds': ['GET'],
  '/api/jds/read': ['GET'],
  '/api/generate-latex': ['POST'],
  // DELETE /api/saved-searches/:id matched by prefix below.
};

const JOBS_JSONL_PATH = join(PROJECT_ROOT, 'data', 'jobs.jsonl');
const SAVED_SEARCHES_PATH = join(PROJECT_ROOT, 'config', 'saved-searches.yml');
const SAVED_SEARCH_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const JOBS_DEFAULT_LIMIT = 50;
const JOBS_MAX_LIMIT = 500;

const SCAN_PORTALS_PATH = join(PROJECT_ROOT, 'portals.yml');
const SCAN_JOB_TTL_MS = 30 * 60_000;            // GC finished jobs after 30 min
const SCAN_RESULTS_DEFAULT_LIMIT = 100;
const SCAN_RESULTS_MAX_LIMIT = 1000;
const SCAN_MAX_QUERY_FIELD = 200;               // max 200 entries per array
const SCAN_MAX_QUERY_STR = 200;                 // max 200 chars per entry

const scanJobs = new Map();                     // job_id -> ScanJob

/**
 * @typedef {object} ScanJob
 * @property {string} id
 * @property {string} state           queued|running|done|error
 * @property {string} started_at
 * @property {string|null} finished_at
 * @property {object} request         { sources, query, dry_run, concurrency, includeDisabled }
 * @property {Record<string,object>} progress
 * @property {object} counts          { found, new, dedup }
 * @property {Array} errors
 * @property {Array} skipped
 * @property {Array} items            normalized Job[] (deduped, post-filter)
 * @property {number} duration_ms
 */

let writeQueue = Promise.resolve();
let commandQueue = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function fileCheck(path, present, fix) {
  return { path, present, fix };
}

function trimInline(value, fallback = '') {
  const text = String(value ?? fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .trim();
  return text || fallback;
}

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function assetUrl(relativePath) {
  return `/assets/${normalizePath(relativePath).split('/').map(encodeURIComponent).join('/')}`;
}

export function parseApplicationsMarkdown(markdown) {
  const applications = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || line.includes('|---') || line.startsWith('| #')) continue;

    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 8) continue;

    const number = Number.parseInt(cells[0], 10);
    if (!Number.isFinite(number)) continue;

    while (cells.length < 9) cells.push('');

    const reportMatch = cells[7].match(/\[([^\]]+)\]\(([^)]+)\)/);
    const scoreMatch = cells[4].match(/(\d+(?:\.\d+)?)\/5/);

    applications.push({
      number,
      date: cells[1],
      company: cells[2],
      role: cells[3],
      score: scoreMatch ? Number.parseFloat(scoreMatch[1]) : 0,
      scoreRaw: cells[4],
      status: cells[5],
      pdf: cells[6].includes('✅'),
      reportPath: reportMatch ? reportMatch[2] : '',
      reportLabel: reportMatch ? reportMatch[1] : '',
      notes: cells[8] || '',
    });
  }
  return applications;
}

export function parsePipelineMarkdown(markdown) {
  const items = [];
  const itemPattern = /^-\s+\[([ xX])\]\s+(\S+)(?:\s+\|\s+([^|]+))?(?:\s+\|\s+(.+))?$/;

  const lines = markdown.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const match = line.match(itemPattern);
    if (!match) return;

    const hasCompanyAndRole = Boolean(match[3] && match[4]);
    items.push({
      lineNumber: index + 1,
      checked: match[1].toLowerCase() === 'x',
      url: match[2],
      company: hasCompanyAndRole ? match[3].trim() : 'Unknown company',
      role: (hasCompanyAndRole ? match[4] : match[3] || match[2]).trim(),
    });
  });

  return items;
}

function mutateApplicationsMarkdown(markdown, applicationNumber, updater) {
  let found = false;
  const lines = markdown.split(/\r?\n/).map((line) => {
    if (!line.trim().startsWith('|') || line.includes('|---') || line.startsWith('| #')) return line;

    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const number = Number.parseInt(cells[0], 10);
    if (number !== applicationNumber || cells.length < 8) return line;

    while (cells.length < 9) cells.push('');
    updater(cells);
    found = true;
    return `| ${cells.join(' | ')} |`;
  });

  if (!found) {
    throw new Error(`Application #${applicationNumber} was not found`);
  }

  return lines.join('\n');
}

export function updateApplicationStatusMarkdown(markdown, applicationNumber, newStatus) {
  if (!STATUS_OPTIONS.includes(newStatus)) {
    throw new Error(`Unsupported status: ${newStatus}`);
  }
  return mutateApplicationsMarkdown(markdown, applicationNumber, (cells) => {
    cells[5] = newStatus;
  });
}

export function updateApplicationNotesMarkdown(markdown, applicationNumber, notes) {
  return mutateApplicationsMarkdown(markdown, applicationNumber, (cells) => {
    // Allow newlines inside notes by encoding them as `\n` literals — the
    // markdown table syntax doesn't permit raw newlines inside a cell. Reading
    // back via parseApplicationsMarkdown leaves the literal `\n` in the cell;
    // the dashboard decodes it for display. Single-line notes look unchanged.
    const encoded = String(notes || '').replace(/\r?\n/g, '\\n').replace(/\|/g, '/').trim();
    cells[8] = encoded;
  });
}

/**
 * Append a new application row to data/applications.md.
 *
 * Fields:
 *   - company, role: required, free-text
 *   - score: optional, numeric — coerced to "X.X/5" format the parser expects
 *   - status: from STATUS_OPTIONS (default: 'Evaluated')
 *   - pdf: bool (default false)
 *   - reportPath: optional relative path; encoded as a markdown link
 *   - notes: optional, single-line for now (newlines collapsed)
 *
 * Returns the new row's number (max-existing + 1).
 *
 * Dedup is the CALLER's responsibility — the helper itself happily appends.
 */
export function appendApplicationMarkdown(markdown, fields) {
  const company = trimInline(fields.company || '');
  const role = trimInline(fields.role || '');
  if (!company || !role) {
    throw new Error('company and role are required');
  }
  const status = fields.status || 'Evaluated';
  if (!STATUS_OPTIONS.includes(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }
  const date = (fields.date || new Date().toISOString().slice(0, 10)).trim();
  const score = formatScoreCell(fields.score);
  const pdfMark = fields.pdf ? '✅' : '❌';
  const reportCell = fields.reportPath
    ? `[${fields.reportLabel || basename(fields.reportPath)}](${fields.reportPath})`
    : '—';
  const notes = String(fields.notes || '').replace(/\r?\n/g, '\\n').replace(/\|/g, '/').trim();

  // Find the next application number — max existing + 1.
  const text = markdown || '';
  const existing = parseApplicationsMarkdown(text);
  const number = existing.length === 0
    ? 1
    : Math.max(...existing.map((a) => a.number)) + 1;

  const row = `| ${number} | ${date} | ${company} | ${role} | ${score} | ${status} | ${pdfMark} | ${reportCell} | ${notes} |`;

  // Insert: if the document has a header row, append after the LAST table row.
  // If there's no header, scaffold one. This mirrors how the legacy CLI flow
  // (merge-tracker.mjs) writes new rows.
  const lines = text.split(/\r?\n/);
  let lastTableLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) lastTableLine = i;
  }
  if (lastTableLine === -1) {
    const scaffold = `# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n${row}\n`;
    return { markdown: scaffold, number };
  }
  lines.splice(lastTableLine + 1, 0, row);
  return { markdown: lines.join('\n'), number };
}

function formatScoreCell(score) {
  if (score == null || score === '' || Number.isNaN(Number(score))) return '0.0/5';
  const n = Math.max(0, Math.min(5, Number(score)));
  return `${n.toFixed(1)}/5`;
}

function basename(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const file = i >= 0 ? s.slice(i + 1) : s;
  return file.replace(/\.md$/i, '');
}

/**
 * Append a pipeline row marked as already-processed (`[x]`). Used when we
 * create an application directly from a job — the URL becomes traceable in
 * pipeline.md without polluting the user's pending inbox.
 */
export function appendProcessedPipelineItemMarkdown(markdown, { url, company, role }) {
  const line = `- [x] ${trimInline(url)} | ${trimInline(company, 'Unknown company')} | ${trimInline(role, trimInline(url))}`;
  let text = markdown || '# career-ops pipeline\n\n';
  const marker = '## Procesadas';
  if (text.indexOf(marker) === -1) {
    if (!text.endsWith('\n')) text += '\n';
    return `${text}\n${marker}\n\n${line}\n`;
  }
  // Insert immediately after the marker.
  const after = text.indexOf(marker) + marker.length;
  const before = text.slice(0, after);
  const rest = text.slice(after);
  // Skip any blank lines after the marker so the insert lands cleanly.
  const m = rest.match(/^\s*\n+/);
  const insertAt = m ? m[0].length : 0;
  return before + rest.slice(0, insertAt) + line + '\n' + rest.slice(insertAt);
}

export function addPipelineItemMarkdown(markdown, { url, company, role }) {
  const line = `- [ ] ${trimInline(url)} | ${trimInline(company, 'Unknown company')} | ${trimInline(role, trimInline(url))}`;
  let text = markdown || '# career-ops pipeline\n\n';

  const marker = '## Pendientes';
  const markerIndex = text.indexOf(marker);

  if (markerIndex === -1) {
    const processIndex = text.indexOf('\n## Procesadas');
    const insertAt = processIndex === -1 ? text.length : processIndex;
    const prefix = text.endsWith('\n') ? text : `${text}\n`;
    const built = `${prefix}${marker}\n\n${line}\n`;
    if (processIndex === -1) return built;
    return `${text.slice(0, insertAt)}\n${marker}\n\n${line}\n${text.slice(insertAt)}`;
  }

  const afterMarker = markerIndex + marker.length;
  const nextSectionIndex = text.indexOf('\n## ', afterMarker);
  const insertAt = nextSectionIndex === -1 ? text.length : nextSectionIndex;
  const before = text.slice(0, insertAt);
  const needsBreak = before.endsWith('\n') ? '' : '\n';
  return `${before}${needsBreak}${line}\n${text.slice(insertAt)}`;
}

export function togglePipelineItemMarkdown(markdown, lineNumber, checked) {
  const lines = markdown.split(/\r?\n/);
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) {
    throw new Error(`Pipeline line ${lineNumber} was not found`);
  }
  const current = lines[index];
  if (!current.trim().startsWith('- [')) {
    throw new Error(`Line ${lineNumber} is not a pipeline entry`);
  }
  lines[index] = current.replace(/^-\s+\[[ xX]\]/, checked ? '- [x]' : '- [ ]');
  return lines.join('\n');
}

export function removePipelineItemMarkdown(markdown, lineNumber) {
  const lines = markdown.split(/\r?\n/);
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) {
    throw new Error(`Pipeline line ${lineNumber} was not found`);
  }
  if (!lines[index].trim().startsWith('- [')) {
    throw new Error(`Line ${lineNumber} is not a pipeline entry`);
  }
  lines.splice(index, 1);

  const compact = [];
  for (const line of lines) {
    if (line === '' && compact[compact.length - 1] === '') continue;
    compact.push(line);
  }
  return compact.join('\n');
}

async function readOptional(path, fallback) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BODY) {
      throw new HttpError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
    throw new Error('JSON body must be an object');
  } catch {
    throw new HttpError(400, 'Invalid JSON payload');
  }
}

function safeJoin(root, userPath) {
  if (typeof userPath !== 'string' || userPath.length === 0) return null;
  const fullPath = resolve(root, userPath);
  const rel = relative(root, fullPath);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return fullPath;
}

async function ensureWorkspaceFiles(root) {
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'reports'), { recursive: true });
  await mkdir(join(root, 'output'), { recursive: true });

  const pipelinePath = join(root, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) {
    await writeFile(pipelinePath, '# career-ops pipeline\n\n## Pendientes\n\n## Procesadas\n', 'utf8');
  }

  const applicationsPath = join(root, 'data', 'applications.md');
  if (!existsSync(applicationsPath)) {
    await writeFile(
      applicationsPath,
      '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n',
      'utf8',
    );
  }
}

async function listFiles(root, relativeDir, allowedExtensions) {
  const absDir = join(root, relativeDir);
  if (!existsSync(absDir)) return [];
  const entries = await readdir(absDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) continue;
    const relativePath = normalizePath(join(relativeDir, entry.name));
    const absPath = join(root, relativePath);
    const details = await stat(absPath);
    files.push({
      name: entry.name,
      path: relativePath,
      size: details.size,
      modifiedAt: details.mtime.toISOString(),
      url: assetUrl(relativePath),
    });
  }

  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return files;
}

function commandCatalog() {
  return Object.entries(COMMANDS).map(([id, def]) => ({
    id,
    label: def.label,
    description: def.description,
  }));
}

export async function computeOverview(root = PROJECT_ROOT) {
  await ensureWorkspaceFiles(root);

  const applicationsText = await readOptional(join(root, 'data', 'applications.md'), '');
  const pipelineText = await readOptional(join(root, 'data', 'pipeline.md'), '');
  const applications = parseApplicationsMarkdown(applicationsText).sort((a, b) => b.number - a.number);
  const pipelineItems = parsePipelineMarkdown(pipelineText);
  const pendingPipeline = pipelineItems.filter((item) => !item.checked);
  const processedPipeline = pipelineItems.filter((item) => item.checked);

  const reports = await listFiles(root, 'reports', new Set(['.md']));
  const outputs = await listFiles(root, 'output', new Set(['.pdf']));

  const byStatus = {};
  let totalScore = 0;
  let scored = 0;
  let withPdf = 0;

  for (const app of applications) {
    const key = String(app.status || 'unknown').toLowerCase();
    byStatus[key] = (byStatus[key] || 0) + 1;
    if (app.score > 0) {
      totalScore += app.score;
      scored += 1;
    }
    if (app.pdf) withPdf += 1;
  }

  const setupChecks = [
    fileCheck('cv.md', existsSync(join(root, 'cv.md')), 'Add your CV in markdown so reports and PDFs can be personalized.'),
    fileCheck('config/profile.yml', existsSync(join(root, 'config', 'profile.yml')), 'Set your name, targets, location, and preferences.'),
    fileCheck('portals.yml', existsSync(join(root, 'portals.yml')), 'Choose which companies and job boards to scan.'),
    fileCheck('data/pipeline.md', existsSync(join(root, 'data', 'pipeline.md')), 'Pipeline file stores pending links discovered from scans.'),
    fileCheck('data/applications.md', existsSync(join(root, 'data', 'applications.md')), 'Tracker table stores your evaluated applications.'),
  ];

  return {
    setup: {
      ready: setupChecks.every((check) => check.present),
      checks: setupChecks,
    },
    metrics: {
      totalApplications: applications.length,
      pendingPipeline: pendingPipeline.length,
      avgScore: scored > 0 ? Number((totalScore / scored).toFixed(1)) : 0,
      withPdf,
      totalReports: reports.length,
      totalOutputs: outputs.length,
      byStatus,
    },
    statusOptions: STATUS_OPTIONS,
    commands: commandCatalog(),
    editableFiles: [...EDITABLE_FILES],
    applications,
    pipeline: pendingPipeline.slice(0, 500),
    pipelineItems: {
      pending: pendingPipeline.slice(0, 500),
      processed: processedPipeline.slice(0, 200),
      total: pipelineItems.length,
    },
    reports,
    outputs,
    generatedAt: new Date().toISOString(),
  };
}

function withWriteLock(task) {
  // Soft 30 s timeout: if a markdown mutation hangs (e.g. fs lock contention,
  // a misbehaving hook), let the next queued task proceed instead of blocking
  // every subsequent write forever. Single-user dashboard — availability beats
  // perfect serialization. The original task still runs to completion in the
  // background; only the queue is unblocked early.
  const wrapped = () => {
    let timeoutId;
    return Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('withWriteLock: task exceeded 30 s soft timeout')),
          30_000,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
  };
  const next = writeQueue.then(wrapped, wrapped);
  writeQueue = next.catch(() => {});
  return next;
}

function withCommandLock(task) {
  const next = commandQueue.then(task, task);
  commandQueue = next.catch(() => {});
  return next;
}

function runCommand(command, args, cwd) {
  const startedAt = Date.now();
  return new Promise((resolveCommand) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout = '', stderr = '') => {
        const code = typeof error?.code === 'number' ? error.code : 0;
        const timeoutHit = error?.killed && /timed out/i.test(error.message);
        resolveCommand({
          ok: !error,
          code,
          stdout: String(stdout).slice(-100000),
          stderr: String(stderr || (error && !timeoutHit ? error.message : '')).slice(-100000),
          durationMs: Date.now() - startedAt,
          timeout: Boolean(timeoutHit),
        });
      },
    );
  });
}

function commonHeaders() {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  };
}

// Relaxed CSP for the Next.js dashboard prefix. Next ships hydration code as
// inline `<script>` tags whose hashes change on every build — strict CSP
// blocks them. We allow inline scripts and styles only under /dashboard so
// the legacy console keeps its tighter policy.
function dashboardHeaders() {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...commonHeaders(),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(payload);
}

// Returns the list of provider IDs that are currently available (env keys set,
// CLI installed, etc.). Used to enrich a "bad model_id" 400 with actionable
// alternatives so the UI can render a picker.
async function listAvailableProviderIds() {
  try {
    const all = await discoverProviders();
    return all.filter((p) => p.availability?.available).map((p) => p.id);
  } catch { return []; }
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...commonHeaders(),
    'content-type': type,
  });
  res.end(body);
}

function getEditablePath(root, path) {
  if (!EDITABLE_FILES.has(path)) {
    throw new HttpError(400, `Unsupported editable path: ${path}`);
  }
  const fullPath = safeJoin(root, path);
  if (!fullPath) throw new HttpError(400, 'Invalid editable path');
  return fullPath;
}

function parseUrls(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const urls = values.map((item) => String(item).trim()).filter(Boolean);
  if (urls.length === 0) throw new HttpError(400, 'At least one URL is required');
  if (urls.length > 20) throw new HttpError(400, 'At most 20 URLs are supported per request');
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    } catch {
      throw new HttpError(400, `Invalid URL: ${url}`);
    }
  }
  return urls;
}

async function handleApi(req, res, root) {
  const url = new URL(req.url, 'http://localhost');

  // Dynamic scanner status/results paths — handled before the static map check.
  if (url.pathname.startsWith('/api/scan/status/') || url.pathname.startsWith('/api/scan/results/')) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: `Method ${req.method} not allowed` });
      return true;
    }
    return await handleScanDynamic(url, res);
  }

  // Dynamic DELETE for saved searches.
  if (url.pathname.startsWith('/api/saved-searches/')) {
    if (req.method !== 'DELETE') {
      sendJson(res, 405, { error: `Method ${req.method} not allowed` });
      return true;
    }
    const id = url.pathname.slice('/api/saved-searches/'.length);
    return await handleSavedSearchDelete(id, res, root);
  }

  const methods = API_METHODS[url.pathname];

  if (url.pathname.startsWith('/api/') && !methods) {
    sendJson(res, 404, { error: 'API endpoint not found' });
    return true;
  }

  if (methods && !methods.includes(req.method)) {
    sendJson(res, 405, { error: `Method ${req.method} not allowed` });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/overview') {
    sendJson(res, 200, await computeOverview(root));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    const path = url.searchParams.get('path');
    if (!path) {
      const files = await Promise.all([...EDITABLE_FILES].map(async (entry) => {
        const fullPath = getEditablePath(root, entry);
        const exists = existsSync(fullPath);
        const size = exists ? (await stat(fullPath)).size : 0;
        return { path: entry, exists, size };
      }));
      sendJson(res, 200, { files });
      return true;
    }

    const fullPath = getEditablePath(root, path);
    sendJson(res, 200, {
      path,
      exists: existsSync(fullPath),
      content: await readOptional(fullPath, ''),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await readJson(req);
    const path = String(body.path || '');
    const content = String(body.content || '');
    if (content.length > MAX_EDITABLE_CONTENT) {
      throw new HttpError(413, 'Content is too large');
    }

    const fullPath = getEditablePath(root, path);
    await withWriteLock(async () => {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    });

    sendJson(res, 200, {
      ok: true,
      path,
      bytes: Buffer.byteLength(content, 'utf8'),
      overview: await computeOverview(root),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/report') {
    const reportPath = String(url.searchParams.get('path') || '');
    const fullPath = safeJoin(root, reportPath);
    const rel = fullPath ? normalizePath(relative(root, fullPath)) : '';

    if (!fullPath || !rel.startsWith('reports/') || extname(fullPath).toLowerCase() !== '.md') {
      throw new HttpError(400, 'Report path is not allowed');
    }

    sendJson(res, 200, {
      path: reportPath,
      content: await readOptional(fullPath, 'Report file not found.'),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/status') {
    const body = await readJson(req);
    const number = Number(body.number);
    const status = String(body.status || '');

    if (!Number.isInteger(number) || number <= 0) {
      throw new HttpError(400, 'Invalid application number');
    }
    if (!STATUS_OPTIONS.includes(status)) {
      throw new HttpError(400, `Unsupported status: ${status}`);
    }

    const appsPath = join(root, 'data', 'applications.md');
    await withWriteLock(async () => {
      const current = await readOptional(appsPath, '');
      const updated = updateApplicationStatusMarkdown(current, number, status);
      await writeFile(appsPath, updated, 'utf8');
    });

    sendJson(res, 200, { ok: true, overview: await computeOverview(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    const body = await readJson(req);
    const number = Number(body.number);
    const notes = String(body.notes || '');

    if (!Number.isInteger(number) || number <= 0) {
      throw new HttpError(400, 'Invalid application number');
    }
    if (notes.length > 1000) {
      throw new HttpError(400, 'Notes are too long (max 1000 chars)');
    }

    const appsPath = join(root, 'data', 'applications.md');
    await withWriteLock(async () => {
      const current = await readOptional(appsPath, '');
      const updated = updateApplicationNotesMarkdown(current, number, notes);
      await writeFile(appsPath, updated, 'utf8');
    });

    sendJson(res, 200, { ok: true, overview: await computeOverview(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/pipeline/add') {
    const body = await readJson(req);
    const entryUrl = String(body.url || '').trim();
    const company = trimInline(body.company, 'Unknown company');
    const role = trimInline(body.role, entryUrl || 'Untitled role');

    try {
      const parsed = new URL(entryUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https are allowed');
      }
    } catch {
      throw new HttpError(400, 'A valid job URL is required');
    }

    const pipelinePath = join(root, 'data', 'pipeline.md');
    await withWriteLock(async () => {
      const current = await readOptional(pipelinePath, '# career-ops pipeline\n\n## Pendientes\n\n## Procesadas\n');
      const updated = addPipelineItemMarkdown(current, { url: entryUrl, company, role });
      await writeFile(pipelinePath, updated, 'utf8');
    });

    sendJson(res, 200, { ok: true, overview: await computeOverview(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/pipeline/toggle') {
    const body = await readJson(req);
    const lineNumber = Number(body.lineNumber);
    const checked = Boolean(body.checked);

    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new HttpError(400, 'Invalid pipeline line number');
    }

    const pipelinePath = join(root, 'data', 'pipeline.md');
    await withWriteLock(async () => {
      const current = await readOptional(pipelinePath, '# career-ops pipeline\n\n## Pendientes\n\n## Procesadas\n');
      const updated = togglePipelineItemMarkdown(current, lineNumber, checked);
      await writeFile(pipelinePath, updated, 'utf8');
    });

    sendJson(res, 200, { ok: true, overview: await computeOverview(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/pipeline/remove') {
    const body = await readJson(req);
    const lineNumber = Number(body.lineNumber);

    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new HttpError(400, 'Invalid pipeline line number');
    }

    const pipelinePath = join(root, 'data', 'pipeline.md');
    await withWriteLock(async () => {
      const current = await readOptional(pipelinePath, '# career-ops pipeline\n\n## Pendientes\n\n## Procesadas\n');
      const updated = removePipelineItemMarkdown(current, lineNumber);
      await writeFile(pipelinePath, updated, 'utf8');
    });

    sendJson(res, 200, { ok: true, overview: await computeOverview(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/command') {
    const body = await readJson(req);
    const commandId = String(body.command || '');
    const commandDef = COMMANDS[commandId];

    if (!commandDef) {
      throw new HttpError(400, `Unknown command: ${commandId}`);
    }

    const result = await withCommandLock(() => runCommand(commandDef.command, commandDef.args, root));
    sendJson(res, 200, {
      ...result,
      command: commandId,
      label: commandDef.label,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/liveness') {
    const body = await readJson(req);
    const urls = parseUrls(body.urls);
    const result = await withCommandLock(() => runCommand('node', ['check-liveness.mjs', ...urls], root));
    sendJson(res, 200, {
      ...result,
      command: 'liveness',
      label: 'Liveness check',
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/scanners') {
    sendJson(res, 200, await listScannersResponse());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/scan/run') {
    const body = await readJson(req);
    const job = await startScanJob(body, root);
    sendJson(res, 202, scanJobView(job));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    sendJson(res, 200, await listJobsResponse(url.searchParams, root));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/sources/health') {
    sendJson(res, 200, await sourcesHealthResponse(root));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sources/probe') {
    // Live-probes every adapter (skip-write disabled so the snapshot updates).
    // Single-user dashboard — long-running but bounded by the probe script's
    // own per-adapter timeout. We pipe through the same command runner used
    // for /api/command so the lock prevents concurrent probes.
    const result = await withCommandLock(
      () => runCommand('node', ['scripts/probe-sources.mjs', '--json'], root),
    );
    let payload = null;
    try { payload = JSON.parse(result.stdout || '{}'); }
    catch { payload = null; }
    sendJson(res, result.ok || result.code === 1 ? 200 : 500, {
      ok: !!result.ok || result.code === 1,
      // exit-1 means the probe ran but found regressions; still useful data.
      probe: payload,
      stderr: (result.stderr || '').slice(-2000),
      durationMs: result.durationMs,
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/saved-searches') {
    sendJson(res, 200, { items: await loadSavedSearches(root) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/saved-searches') {
    const body = await readJson(req);
    const saved = await upsertSavedSearch(body, root);
    sendJson(res, 200, saved);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/applications') {
    const body = await readJson(req);
    const result = await createApplication(body, root);
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/agents') {
    sendJson(res, 200, await discoverProviders());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/evaluate') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: body.mode || 'oferta',
      saveReportOnDone: true,
      composeUser: () => composeJdMessage({ jdText: body.jd_text, jdUrl: body.jd_url }),
      kind: 'evaluation',
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/draft-application') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'apply',
      saveReportOnDone: false,
      composeUser: () => composeApplyMessage(body, root),
      kind: 'apply',
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/deep-research') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'deep',
      saveReportOnDone: true,
      composeUser: () => `Research the company "${String(body.company || '').trim()}" deeply.\n${body.context || ''}`,
      kind: 'deep',
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/contacto') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'contacto',
      saveReportOnDone: false,
      composeUser: () => `COMPANY: ${body.company}\nROLE: ${body.role}\nDraft 3 short LinkedIn outreach messages aimed at finding a hiring manager or recruiter.`,
      kind: 'contacto',
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate-pdf') {
    const body = await readJson(req);
    sendJson(res, 200, await generateTailoredPdf(body, root));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate-cv') {
    const body = await readJson(req);
    await streamCvStudio({ req, res, body, root });
    return true;
  }

  // — Quick agent endpoints: each surfaces a specific mode through the same
  //   streamAgentRun harness used by /api/evaluate. The differences are mode
  //   name, user-message composer, and whether to save a report on done.

  if (req.method === 'POST' && url.pathname === '/api/eval-training') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'training',
      saveReportOnDone: false,
      kind: 'training',
      composeUser: () => `EVALUATE THIS COURSE / CERTIFICATION:\n\n${String(body.text || '').trim()}`,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/eval-project') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'project',
      saveReportOnDone: false,
      kind: 'project',
      composeUser: () => `EVALUATE THIS PORTFOLIO PROJECT IDEA:\n\n${String(body.text || '').trim()}`,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/interview-prep') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'interview-prep',
      saveReportOnDone: false,
      kind: 'interview-prep',
      composeUser: () => composeInterviewPrepMessage(body, root),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/draft-followup') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'followup',
      saveReportOnDone: false,
      kind: 'followup',
      composeUser: () => composeFollowupMessage(body),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/compare-offers') {
    const body = await readJson(req);
    await streamAgentRun({
      req, res, body, root,
      mode: 'ofertas',
      saveReportOnDone: false,
      kind: 'ofertas',
      composeUser: () => composeCompareMessage(body, root),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/jds') {
    sendJson(res, 200, { items: await listJdsFolder(root) });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/jds/read') {
    const file = url.searchParams.get('path') || '';
    sendJson(res, 200, await readJdFile(root, file));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate-latex') {
    const body = await readJson(req);
    sendJson(res, 200, await generateLatexCv(body, root));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/gemini-eval') {
    const body = await readJson(req);
    const prompt = String(body.text || '').trim();

    if (prompt.length < 20) {
      throw new HttpError(400, 'Provide at least 20 characters of JD text to evaluate');
    }
    if (prompt.length > 12000) {
      throw new HttpError(400, 'Prompt is too long (max 12,000 chars)');
    }

    const result = await withCommandLock(() => runCommand('node', ['gemini-eval.mjs', prompt], root));
    sendJson(res, 200, {
      ...result,
      command: 'gemini-eval',
      label: 'Gemini evaluation',
    });
    return true;
  }

  return false;
}

// ── Scanner endpoints ────────────────────────────────────────────────────────
//
// These endpoints expose the scanners/ system over HTTP so a future frontend
// can pick adapters, supply a free-text query, kick off a scan, and stream
// progress. The scan runs in-process (no subprocess) so we get per-adapter
// lifecycle events without parsing stdout.
//
// State is held in the in-memory `scanJobs` Map. The durable record of
// discovered jobs is still data/jobs.jsonl (written by appendJsonl).

let _adaptersPromise = null;

async function getAdapters() {
  if (!_adaptersPromise) _adaptersPromise = loadAdapters({});
  return _adaptersPromise;
}

function loadPortalsConfig(root = PROJECT_ROOT) {
  // Honor the per-request root when present so tests that build a tmpdir
  // workspace don't accidentally read the live project config. SCAN_PORTALS_PATH
  // remains the legacy default for callers that don't thread root through.
  const path = root === PROJECT_ROOT ? SCAN_PORTALS_PATH : join(root, 'portals.yml');
  if (!existsSync(path)) return {};
  try {
    return yaml.load(readFileSync(path, 'utf-8')) || {};
  } catch (err) {
    throw new HttpError(500, `Failed to parse portals.yml: ${err.message}`);
  }
}

async function listScannersResponse() {
  const adapters = await getAdapters();
  const config = loadPortalsConfig();
  const sources = config.sources || {};
  return adapters.map((a) => ({
    id: a.id,
    kind: a.kind,
    file: a.file,
    regions: a.meta.regions || [],
    requiresKey: !!a.meta.requiresKey,
    requiresKeySatisfied: a.requiresKeySatisfied,
    envKeys: a.envKeys || [],
    missingEnv: a.missingEnv || [],
    enabledInConfig: sources[a.id]?.enabled === true,
    unavailable: a.meta.unavailable === true,
    supports: a.meta.supports || {},
    presets: a.meta.presets || {},
    schema: a.meta.schema || {},
    docs: a.meta.docs || null,
    warning: a.meta.warning || null,
  }));
}

/**
 * Validate the body of `POST /api/scan/run` — never trust the wire. Returns a
 * sanitized { sources, query, dry_run, concurrency, includeDisabled, persist }.
 */
function validateScanRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid request body');

  const sources = Array.isArray(body.sources)
    ? body.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
    : null;

  const queryIn = body.query && typeof body.query === 'object' ? body.query : {};
  const query = {};
  for (const field of ['titles', 'regions', 'locations', 'companies']) {
    const arr = queryIn[field];
    if (!Array.isArray(arr)) continue;
    const cleaned = arr
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0 && s.length <= SCAN_MAX_QUERY_STR)
      .slice(0, SCAN_MAX_QUERY_FIELD);
    if (cleaned.length) query[field] = cleaned;
  }
  if (queryIn.remote === true || queryIn.remote === false) query.remote = queryIn.remote;

  // Time-window filter: drop jobs older than N days during the scan. Accepts
  // either query.since_days or top-level since_days for ergonomics.
  const sinceRaw = queryIn.since_days ?? queryIn.sinceDays ?? body.since_days ?? body.sinceDays;
  if (sinceRaw != null) {
    const n = Number(sinceRaw);
    if (Number.isFinite(n) && n > 0) query.sinceDays = Math.min(365, Math.floor(n));
  }

  const concurrency = Number.isFinite(body.concurrency) ? Math.max(1, Math.min(20, Math.floor(body.concurrency))) : 5;
  const dry_run = body.dry_run === true;
  const includeDisabled = body.include_disabled === true || body.includeDisabled === true;
  const persist = body.persist !== false && !dry_run;

  return { sources, query, dry_run, concurrency, includeDisabled, persist };
}

async function startScanJob(body, root) {
  const req = validateScanRequest(body);
  const adapters = await getAdapters();
  const config = loadPortalsConfig();

  // Filter adapters if `sources` was supplied. We do this here (rather than
  // re-loading via loadAdapters({only})) so the env-key metadata stays cached.
  const targets = req.sources
    ? adapters.filter((a) => req.sources.includes(a.id))
    : adapters;

  if (req.sources && targets.length === 0) {
    throw new HttpError(400, `Unknown source ids: ${req.sources.join(', ')}`);
  }

  const id = randomUUID();
  /** @type {ScanJob} */
  const job = {
    id,
    state: 'running',
    started_at: new Date().toISOString(),
    finished_at: null,
    request: req,
    progress: {},
    counts: { found: 0, new: 0, dedup: 0, dedup_role: 0 },
    errors: [],
    skipped: [],
    items: [],
    duration_ms: 0,
  };
  for (const a of targets) job.progress[a.id] = { state: 'pending' };
  scanJobs.set(id, job);

  // Run async — do not await. The HTTP response returns the job id immediately.
  runScanJob(job, targets, config, root).catch((err) => {
    job.state = 'error';
    job.errors.push({ id: 'orchestrator', error: err?.message || String(err) });
    job.finished_at = new Date().toISOString();
  });

  return job;
}

async function runScanJob(job, adapters, config, root) {
  const t0 = Date.now();
  const onProgress = (evt) => {
    if (!evt?.id) return;
    job.progress[evt.id] = { ...job.progress[evt.id], ...evt };
  };

  const { jobs, errors, stats, skipped } = await runAdapters({
    config,
    adapters,
    concurrency: job.request.concurrency,
    log: () => {},                              // suppress stderr from in-process scans
    query: job.request.query,
    includeDisabled: job.request.includeDisabled,
    progress: onProgress,
  });

  job.errors = errors;
  job.skipped = skipped || [];
  job.stats = stats;
  job.counts.found = jobs.length;

  // Dedup against persisted history + within this run.
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const intra = new Set();
  const fresh = [];
  for (const j of jobs) {
    const url = canonicalUrl(j.url);
    if (!url) continue;
    if (seenUrls.has(url) || intra.has(url)) { job.counts.dedup++; continue; }
    intra.add(url);
    const key = `${(j.company || '').toLowerCase()}::${(j.title || '').toLowerCase()}`;
    if (seenCompanyRoles.has(key)) { job.counts.dedup_role++; continue; }
    seenCompanyRoles.add(key);
    fresh.push({ ...j, url });
  }

  job.items = fresh;
  job.counts.new = fresh.length;

  if (job.request.persist && fresh.length > 0) {
    await withWriteLock(async () => {
      appendJsonl(fresh);
      appendScanHistory(fresh);
      appendPipeline(fresh);
    });
  }

  job.state = 'done';
  job.duration_ms = Date.now() - t0;
  job.finished_at = new Date().toISOString();
  scheduleScanGC();
}

let _gcTimer = null;
function scheduleScanGC() {
  if (_gcTimer) return;
  _gcTimer = setTimeout(() => {
    _gcTimer = null;
    const cutoff = Date.now() - SCAN_JOB_TTL_MS;
    for (const [id, j] of scanJobs.entries()) {
      const finished = j.finished_at ? new Date(j.finished_at).getTime() : 0;
      if (finished && finished < cutoff) scanJobs.delete(id);
    }
    if (scanJobs.size > 0) scheduleScanGC();
  }, 5 * 60_000).unref?.();
}

function scanJobView(job) {
  return {
    job_id: job.id,
    state: job.state,
    started_at: job.started_at,
    finished_at: job.finished_at,
    duration_ms: job.duration_ms || 0,
    request: job.request,
    progress: job.progress,
    counts: job.counts,
    errors: job.errors,
    skipped: job.skipped,
    stats: job.stats || [],
  };
}

async function handleScanDynamic(url, res) {
  if (url.pathname.startsWith('/api/scan/status/')) {
    const id = url.pathname.slice('/api/scan/status/'.length);
    const job = scanJobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: 'scan job not found' });
      return true;
    }
    sendJson(res, 200, scanJobView(job));
    return true;
  }

  if (url.pathname.startsWith('/api/scan/results/')) {
    const id = url.pathname.slice('/api/scan/results/'.length);
    const job = scanJobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: 'scan job not found' });
      return true;
    }
    const limit = Math.max(1, Math.min(SCAN_RESULTS_MAX_LIMIT,
      Number(url.searchParams.get('limit')) || SCAN_RESULTS_DEFAULT_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const items = job.items.slice(offset, offset + limit);
    sendJson(res, 200, {
      job_id: job.id,
      state: job.state,
      total: job.items.length,
      offset,
      limit,
      items,
    });
    return true;
  }

  return false;
}

// ── End scanner endpoints ───────────────────────────────────────────────────

// ── Phase H — UI-facing read endpoints + saved searches ─────────────────────
//
// These are the endpoints any frontend (single-user dashboard or eventual SaaS)
// will hit constantly. They read from the existing data/jobs.jsonl file
// (canonical scanner output) and config/saved-searches.yml — no new data
// formats, no new dependencies, fully back-compat.

/**
 * GET /api/jobs?region=&source=&since=&q=&remote=&limit=&offset=
 *
 * Returns paginated, filtered jobs from data/jobs.jsonl. Filters are AND-ed.
 *  - region   = comma-separated region_group values (pakistan,gcc,…)
 *  - source   = comma-separated provider ids
 *  - since    = days back (e.g. 7)
 *  - q        = case-insensitive substring matched against title + company
 *  - remote   = "true"|"false"|"any" — filter on j.remote
 *  - limit    = page size (default 50, max 500)
 *  - offset   = page offset (default 0)
 *
 * Streams the jsonl file once per request — fine for tens of thousands of
 * lines. When the file grows past that, this turns into a Postgres query.
 */
async function listJobsResponse(params, root) {
  const path = join(root, 'data', 'jobs.jsonl');
  const limit = Math.max(1, Math.min(JOBS_MAX_LIMIT, Number(params.get('limit')) || JOBS_DEFAULT_LIMIT));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const filters = parseJobsFilters(params);

  if (!existsSync(path)) {
    return { total: 0, offset, limit, items: [], filters };
  }
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const matched = [];
  for (const line of lines) {
    if (!line) continue;
    let job;
    try { job = JSON.parse(line); } catch { continue; }
    if (!matchesJobFilters(job, filters)) continue;
    matched.push(job);
  }
  // Newest-first: prefer _scanned_at, fall back to posted_at.
  matched.sort((a, b) => {
    const ta = Date.parse(a._scanned_at || a.posted_at || a.date_posted || 0) || 0;
    const tb = Date.parse(b._scanned_at || b.posted_at || b.date_posted || 0) || 0;
    return tb - ta;
  });
  const items = matched.slice(offset, offset + limit);
  return { total: matched.length, offset, limit, filters, items };
}

function parseJobsFilters(params) {
  const split = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const since = Number(params.get('since'));
  const remoteRaw = params.get('remote');
  return {
    regions: split(params.get('region')),
    sources: split(params.get('source')),
    sinceDays: Number.isFinite(since) && since > 0 ? since : null,
    query: String(params.get('q') || '').trim().toLowerCase(),
    remote: remoteRaw === 'true' ? true : (remoteRaw === 'false' ? false : null),
  };
}

function matchesJobFilters(job, f) {
  if (f.regions.length && !f.regions.includes(String(job.region_group || '').toLowerCase())) return false;
  if (f.sources.length && !f.sources.includes(String(job.source || '').toLowerCase())) return false;
  if (f.remote != null && Boolean(job.remote) !== f.remote) return false;
  if (f.sinceDays != null) {
    const ts = Date.parse(job.posted_at || job.date_posted || job._scanned_at || 0);
    if (!ts) return false;
    if (Date.now() - ts > f.sinceDays * 86_400_000) return false;
  }
  if (f.query) {
    const blob = `${job.title || ''} ${job.company || ''}`.toLowerCase();
    if (!blob.includes(f.query)) return false;
  }
  return true;
}

/**
 * GET /api/sources/health
 *
 * Returns one row per discovered adapter, joined with derived stats from
 * data/jobs.jsonl: total jobs, jobs in the last 7 days, last_seen_at. Also
 * surfaces requiresKey state so a UI can show "needs configuration".
 */
async function sourcesHealthResponse(root) {
  const adapters = await getAdapters();
  const path = join(root, 'data', 'jobs.jsonl');
  const stats = new Map();        // sourceId -> { total, in7d, lastSeenAt }
  const cutoff7d = Date.now() - 7 * 86_400_000;
  if (existsSync(path)) {
    const text = await readFile(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      let job;
      try { job = JSON.parse(line); } catch { continue; }
      const id = String(job.source || 'unknown');
      const ts = Date.parse(job._scanned_at || job.posted_at || job.date_posted || 0) || 0;
      const cur = stats.get(id) || { total: 0, in7d: 0, lastSeenAt: 0 };
      cur.total += 1;
      if (ts && ts >= cutoff7d) cur.in7d += 1;
      if (ts > cur.lastSeenAt) cur.lastSeenAt = ts;
      stats.set(id, cur);
    }
  }
  // Pull last-error info from in-memory scan job log when available.
  const recentErrors = collectRecentScanErrors();
  // Read portals.yml so we can tell whether a `requiresInputs` adapter
  // (e.g. Greenhouse needing companies) actually has its inputs configured.
  const config = loadPortalsConfig(root);
  const sources = config.sources || {};
  // Read the most recent probe snapshot so the UI can show a real
  // first-job sample for adapters that haven't appeared in a scan yet
  // (otherwise they sit at "unknown" forever, which is uninformative).
  const probeSamples = loadProbeSamples(root);
  const probedAt = probeSamples?._probed_at || null;

  return adapters.map((a) => {
    const s = stats.get(a.id) || { total: 0, in7d: 0, lastSeenAt: 0 };
    const lastError = recentErrors.get(a.id) || null;
    const requiresInputs = Array.isArray(a.meta.requiresInputs) ? a.meta.requiresInputs : [];
    const cfg = sources[a.id] || {};
    const missingInputs = requiresInputs.filter((k) => {
      const v = cfg[k];
      return !Array.isArray(v) || v.length === 0;
    });
    // requiresAck is a single boolean opt-in flag (e.g. linkedin-guest's
    // `acknowledge_tos_risk`). It's not in `cfg` until the user flips it.
    const requiresAck = a.meta.requiresAck || null;
    const ackMissing = requiresAck ? cfg[requiresAck] !== true : false;
    const status = computeAdapterStatus(a, s, lastError, missingInputs, ackMissing);
    return {
      id: a.id,
      kind: a.kind,
      regions: a.meta.regions || [],
      requiresKey: !!a.meta.requiresKey,
      requiresKeySatisfied: a.requiresKeySatisfied,
      missingEnv: a.missingEnv || [],
      requiresInputs,
      missingInputs,
      requiresAck,
      ackMissing,
      unavailable: a.meta.unavailable === true,
      warning: a.meta.warning || null,
      // Surface signup info so the UI can render a one-click "Get a free key"
      // link next to needs_config sources.
      signupUrl: a.meta.signupUrl || null,
      freeTier: a.meta.freeTier || null,
      docs: a.meta.docs || null,
      total: s.total,
      jobs_7d: s.in7d,
      last_seen_at: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
      last_error: lastError,
      status,
      // Probe-derived: a real (title, url, company) tuple captured the last
      // time the user ran "Probe sources now". Lets the UI show proof-of-life
      // even before any jobs have been ingested into jobs.jsonl.
      probe_sample: probeSamples?.[a.id] || null,
      probed_at: probedAt,
    };
  });
}

// Reads data/source-health.json (written by scripts/probe-sources.mjs) and
// returns a flat map of sourceId → sample data. Returns null when the file
// hasn't been generated yet. Tolerant of partial/corrupt files.
function loadProbeSamples(root) {
  const path = join(root, 'data', 'source-health.json');
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const out = { _probed_at: data.probed_at || null };
    for (const row of data.sources || []) {
      if (row?.id) out[row.id] = row.sample || null;
    }
    return out;
  } catch {
    return null;
  }
}

function computeAdapterStatus(adapter, stats, lastError, missingInputs = [], ackMissing = false) {
  if (adapter.meta.unavailable === true) return 'unavailable';
  if (adapter.meta.requiresKey && !adapter.requiresKeySatisfied) return 'needs_config';
  // 'needs_inputs' only beats stale/healthy when there's no historical data
  // at all. If the user previously configured companies and ran a scan, we
  // still want to show the rich 'stale' / 'healthy' signal even after they
  // wiped the config — the data is real.
  if (lastError) return 'error';
  if (stats.in7d > 0) return 'healthy';
  if (stats.total > 0) return 'stale';
  // ATS adapters (and the JSON-LD universal scraper) need a list of
  // companies / urls before they can run. With no inputs AND no historical
  // data, that's the clearest signal we can show — actionable hint instead
  // of "unknown".
  if (missingInputs.length) return 'needs_inputs';
  if (ackMissing) return 'needs_ack';
  return 'unknown';
}

function collectRecentScanErrors() {
  const out = new Map();
  // Walk most-recent jobs first so a later success overrides an earlier error.
  const jobs = [...scanJobs.values()].sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  );
  for (const job of jobs) {
    for (const e of job.errors || []) {
      if (!out.has(e.id)) out.set(e.id, { error: e.error, at: job.started_at });
    }
    // A successful adapter run wipes a stale error.
    for (const stat of job.stats || []) {
      if (!stat.error && out.has(stat.id)) out.delete(stat.id);
    }
  }
  return out;
}

/**
 * Saved searches — config/saved-searches.yml is a plain list:
 *   searches:
 *     - id: pk-engineering
 *       name: PK Engineering
 *       region: [pakistan]
 *       titles: [engineer, developer]
 *       sources: [greenhouse, mustakbil]
 *       since_days: 7
 *       created_at: 2026-04-25T12:00:00Z
 *
 * The frontend fetches the list on load, posts new entries with a stable
 * slug `id`, and DELETEs by id. We keep the storage in YAML so the user can
 * hand-edit it like the rest of the project's config.
 */
async function loadSavedSearches(root) {
  const path = join(root, 'config', 'saved-searches.yml');
  if (!existsSync(path)) return [];
  let parsed;
  try { parsed = yaml.load(await readFile(path, 'utf8')) || {}; }
  catch { throw new HttpError(500, 'config/saved-searches.yml is malformed'); }
  const list = Array.isArray(parsed.searches) ? parsed.searches : [];
  return list.filter((s) => s && SAVED_SEARCH_ID_RE.test(String(s.id || '')));
}

async function upsertSavedSearch(body, root) {
  const entry = validateSavedSearch(body);
  const path = join(root, 'config', 'saved-searches.yml');
  return await withWriteLock(async () => {
    const items = await loadSavedSearches(root);
    const existing = items.findIndex((s) => s.id === entry.id);
    if (existing >= 0) {
      // Preserve created_at across updates so the UI can sort by recency stably.
      entry.created_at = items[existing].created_at || entry.created_at;
      items[existing] = entry;
    } else {
      items.push(entry);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, yaml.dump({ searches: items }, { lineWidth: 120 }), 'utf8');
    return entry;
  });
}

async function handleSavedSearchDelete(id, res, root) {
  if (!SAVED_SEARCH_ID_RE.test(id)) {
    sendJson(res, 400, { error: 'invalid saved search id' });
    return true;
  }
  const path = join(root, 'config', 'saved-searches.yml');
  await withWriteLock(async () => {
    const items = await loadSavedSearches(root);
    const next = items.filter((s) => s.id !== id);
    if (next.length === items.length) {
      sendJson(res, 404, { error: 'saved search not found' });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, yaml.dump({ searches: next }, { lineWidth: 120 }), 'utf8');
    sendJson(res, 200, { ok: true, id });
  });
  return true;
}

function validateSavedSearch(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be a JSON object');
  const id = String(body.id || '').trim().toLowerCase();
  if (!SAVED_SEARCH_ID_RE.test(id)) {
    throw new HttpError(400, 'id must match /^[a-z0-9][a-z0-9_-]{0,63}$/');
  }
  const name = String(body.name || '').trim().slice(0, 200);
  if (!name) throw new HttpError(400, 'name is required');
  const arr = (v, max = 50, maxLen = 200) => Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter((s) => s && s.length <= maxLen).slice(0, max)
    : [];
  const sinceDaysRaw = body.since_days ?? body.sinceDays;
  const sinceDays = Number.isFinite(Number(sinceDaysRaw)) && Number(sinceDaysRaw) > 0
    ? Math.min(365, Math.floor(Number(sinceDaysRaw)))
    : null;
  return {
    id,
    name,
    region: arr(body.region || body.regions),
    titles: arr(body.titles),
    sources: arr(body.sources),
    locations: arr(body.locations),
    since_days: sinceDays,
    remote: body.remote === true ? true : (body.remote === false ? false : null),
    created_at: body.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── End Phase H endpoints ───────────────────────────────────────────────────

// ── Apply flow — POST /api/applications ─────────────────────────────────────

const VALID_URL_RE = /^https?:\/\/.+$/i;
const APPLICATIONS_PATH = (root) => join(root, 'data', 'applications.md');
const PIPELINE_PATH = (root) => join(root, 'data', 'pipeline.md');

/**
 * POST /api/applications — create a new application row.
 *
 * Body shape:
 *   {
 *     company: string,             // required
 *     role: string,                // required
 *     status?: string,             // STATUS_OPTIONS member, default 'Evaluated'
 *     score?: number,              // 0..5
 *     url?: string,                // if supplied, also seeds pipeline.md
 *     notes?: string,              // free-text, newlines OK
 *     pdf?: boolean,
 *     report_path?: string,        // relative to project root
 *     allow_duplicate?: boolean,   // bypass (company, role) dupe check
 *   }
 *
 * Conflict semantics:
 *   - Returns HTTP 409 when (company, role) pair already exists, with the
 *     existing row's number in the body. The dashboard surfaces this as a
 *     "Already in tracker — open it?" toast.
 *   - The user can pass `allow_duplicate: true` to force a new row anyway
 *     (rare — same company different role variant would normally vary `role`).
 */
async function createApplication(body, root) {
  const company = String(body?.company || '').trim();
  const role = String(body?.role || '').trim();
  if (!company) throw new HttpError(400, 'company is required');
  if (!role) throw new HttpError(400, 'role is required');
  if (company.length > 200 || role.length > 200) {
    throw new HttpError(400, 'company and role must be ≤ 200 chars');
  }
  const status = body?.status ? String(body.status) : 'Evaluated';
  if (!STATUS_OPTIONS.includes(status)) {
    throw new HttpError(400, `Unsupported status "${status}". Must be one of: ${STATUS_OPTIONS.join(', ')}`);
  }
  if (body?.score != null && (Number.isNaN(Number(body.score)) || Number(body.score) < 0 || Number(body.score) > 5)) {
    throw new HttpError(400, 'score must be a number between 0 and 5');
  }
  if (body?.url && !VALID_URL_RE.test(String(body.url).trim())) {
    throw new HttpError(400, 'url must be http(s)://…');
  }
  const notes = String(body?.notes || '');
  if (notes.length > 4000) throw new HttpError(400, 'notes is too long (max 4000 chars)');

  const appsPath = APPLICATIONS_PATH(root);
  const pipelinePath = PIPELINE_PATH(root);

  return await withWriteLock(async () => {
    const before = await readOptional(appsPath, '');
    const existing = parseApplicationsMarkdown(before);

    if (!body?.allow_duplicate) {
      const lc = (s) => String(s).trim().toLowerCase();
      const dup = existing.find((a) => lc(a.company) === lc(company) && lc(a.role) === lc(role));
      if (dup) {
        throw new HttpError(409, JSON.stringify({
          error: 'duplicate',
          message: `An application for "${company} — ${role}" already exists as #${dup.number}.`,
          existing: dup,
        }));
      }
    }

    const { markdown: nextApps, number } = appendApplicationMarkdown(before, {
      company,
      role,
      status,
      score: body?.score,
      pdf: !!body?.pdf,
      reportPath: body?.report_path || '',
      notes,
    });
    await mkdir(dirname(appsPath), { recursive: true });
    await writeFile(appsPath, nextApps, 'utf8');

    // Seed pipeline.md so the URL is traceable. Mark as processed so it doesn't
    // pollute the pending inbox. Idempotent: skip if the URL already appears.
    if (body?.url) {
      const url = String(body.url).trim();
      const beforePipe = await readOptional(pipelinePath, '');
      const alreadyTracked = beforePipe.includes(url);
      if (!alreadyTracked) {
        const nextPipe = appendProcessedPipelineItemMarkdown(beforePipe, { url, company, role });
        await writeFile(pipelinePath, nextPipe, 'utf8');
      }
    }

    return {
      ok: true,
      number,
      overview: await computeOverview(root),
    };
  });
}

// ── End apply-flow endpoints ────────────────────────────────────────────────

// ── Phase K — Agent-driven evaluations / drafts (SSE streaming) ─────────────
//
// Every agent-driven endpoint shares the same shape: pick a mode file, compose
// a system prompt + user message, stream the model's response back to the
// client, optionally save a report. `streamAgentRun` is the orchestrator;
// the per-endpoint handlers above just hand it a mode + a user-message
// composer.
//
// Wire format is Server-Sent Events:
//   event: token   data: { "chunk": "…", "i": <int> }
//   event: done    data: { "text": "…", "summary": {...}, "report_path": "…" }
//   event: error   data: { "message": "…", "hint": "…" }

async function streamAgentRun({
  req, res, body, root, mode, kind, composeUser, saveReportOnDone,
}) {
  const language = String(body.language || '').toLowerCase().slice(0, 4);
  const modelId = String(body.model_id || '').trim();

  // Resolve provider before opening the SSE stream so an unavailable model
  // returns a normal HTTP 4xx instead of an awkward partial event stream.
  let provider;
  try {
    provider = modelId ? getProvider(modelId) : await defaultProvider();
  } catch (err) {
    // Surface the list of available providers so the dashboard can render an
    // actionable picker rather than the user guessing model_id strings.
    const available = await listAvailableProviderIds();
    sendJson(res, 400, { error: String(err?.message || err), available_providers: available });
    return;
  }
  const avail = await provider.available();
  if (!avail.available) {
    sendJson(res, 503, { error: avail.reason || 'provider unavailable', hint: avail.hint });
    return;
  }

  // Resolve mode file with optional language override (modes/{lang}/{mode}.md).
  let modeFile;
  try {
    modeFile = resolveModeFile(root, mode, language);
  } catch (err) {
    sendJson(res, 400, { error: String(err?.message || err) });
    return;
  }

  // Compose prompt now. If composeUser throws (bad input), bail before
  // opening the SSE stream.
  let userMessage;
  try { userMessage = String(composeUser() || ''); }
  catch (err) {
    sendJson(res, 400, { error: String(err?.message || err) });
    return;
  }
  // Hard floor on user-message length — if the dashboard passes a near-empty
  // JD (job with no description and no URL), the model would just halucinate.
  // Prefer a clear 4xx so the user knows to paste actual JD content.
  if (userMessage.trim().length < 40) {
    sendJson(res, 400, {
      error: 'Job description is too short to evaluate.',
      hint: 'Paste the full JD text in the dialog before clicking Run, or supply jd_url for a posting with parseable text.',
    });
    return;
  }

  const ctxBundle = readContextBundle(root, { language });
  const systemPrompt = composeSystemPrompt({
    shared: ctxBundle.shared,
    profile: ctxBundle.profile,
    modeText: modeFile.text,
    modeName: mode,
    cv: ctxBundle.cv,
    digest: ctxBundle.digest,
  });

  // Open the SSE stream now. Headers must go out before the first chunk.
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',                // disable nginx-style buffering
    'connection': 'keep-alive',
  });
  // Initial comment kicks the connection awake on some browsers.
  res.write(': agent-run-started\n\n');

  // SSE keepalive: many proxies/load balancers close idle connections after
  // 30–90 s. The provider can take much longer than that for long evaluations,
  // so emit a comment line every 20 s. Comments (lines starting with ":") are
  // ignored by EventSource clients but keep the TCP connection warm.
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); }
    catch { clearInterval(keepalive); }
  }, 20_000);
  const stopKeepalive = () => clearInterval(keepalive);

  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Hook into client disconnects so we can abort the provider call.
  const ac = new AbortController();
  req.on('close', () => { ac.abort(); stopKeepalive(); });

  let combined = '';
  const onToken = (evt) => {
    combined += evt.chunk;
    writeEvent('token', { chunk: evt.chunk, i: evt.tokenIndex });
  };

  let result;
  try {
    result = await provider.run({
      system: systemPrompt,
      user: userMessage,
      onToken,
      signal: ac.signal,
    });
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : String(err?.message || err);
    const hint = err instanceof ProviderError ? err.hint : undefined;
    writeEvent('error', { message, hint, provider: provider.id });
    stopKeepalive();
    res.end();
    return;
  }

  // Parse the score summary — only meaningful for evaluation modes; other
  // modes will simply not have one and we degrade gracefully.
  const summary = parseScoreSummary(result.text);
  const body_ = stripScoreSummary(result.text);

  let reportPath = null;
  if (saveReportOnDone && summary && body_) {
    try {
      const saved = saveReport({
        reportsDir: join(root, 'reports'),
        rootDir: root,
        body: body_,
        summary,
        toolLabel: kind === 'evaluation' ? 'Career-Ops · A–G evaluation' : `Career-Ops · ${kind}`,
        modelLabel: `${provider.label} (${result.model})`,
      });
      reportPath = saved.path;
    } catch (err) {
      // Surface but don't kill the response — the user still got the text.
      writeEvent('warning', { message: `Couldn't save report: ${String(err?.message || err)}` });
    }
  }

  writeEvent('done', {
    text: body_ || result.text,
    summary,
    report_path: reportPath,
    model: result.model,
    provider: provider.id,
    duration_ms: result.durationMs,
    usage: result.usage,
  });
  stopKeepalive();
  res.end();
}

function composeApplyMessage(body, root = PROJECT_ROOT) {
  const lines = [];
  if (body.jd_text) lines.push(`JOB DESCRIPTION:\n\n${body.jd_text}`);
  // safeJoin guards the report_path against path traversal — ../etc/passwd
  // would resolve outside the project root and return null.
  const safe = body.report_path ? safeJoin(root, String(body.report_path)) : null;
  if (safe && existsSync(safe)) {
    lines.push(`PRIOR EVALUATION REPORT (${body.report_path}):\n\n` + readFileSync(safe, 'utf8'));
  }
  if (Array.isArray(body.questions) && body.questions.length) {
    lines.push(`APPLICATION FORM QUESTIONS:\n\n${body.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }
  lines.push(`Draft concise, candidate-voiced answers for each question. Output one section per question with a heading.`);
  return lines.join('\n\n');
}

/**
 * POST /api/generate-pdf — wrap generate-pdf.mjs.
 *
 * For now this is the simple "render existing CV via the template into a
 * tailored PDF" path. A future iteration can pre-process the CV through
 * `modes/pdf.md` to inject keywords from the JD; we intentionally ship the
 * non-tailored variant first because it depends only on the existing
 * `templates/cv-template.html` file and Playwright (already installed).
 */
/**
 * POST /api/generate-pdf — wrap generate-pdf.mjs as a child process.
 *
 * IMPORTANT: do NOT `import('./generate-pdf.mjs')` from here. That file ends
 * with `generatePDF().catch(...)` which executes on import, spawning
 * Playwright and writing a PDF as a side-effect. Until generate-pdf.mjs is
 * refactored to export a pure function, the only safe path is execFile.
 *
 * For the dashboard's "Generate tailored CV" button this is fine — the user
 * is asking for a PDF anyway. The 5–15 s spin-up is acceptable.
 */
async function generateTailoredPdf(body, root) {
  // User-supplied paths are validated via safeJoin so they cannot escape the
  // project root. Defaults stay inside output/ as before. Any traversal
  // attempt (e.g. body.output_path = '../etc/passwd') returns a 400.
  const inputHtml = body.html_path
    ? safeJoin(root, String(body.html_path))
    : join(root, 'output', 'cv-rendered.html');
  const outputPdf = body.output_path
    ? safeJoin(root, String(body.output_path))
    : join(root, 'output', 'cv-tailored.pdf');
  if (!inputHtml || !outputPdf) {
    return { ok: false, error: 'html_path / output_path must resolve inside the project root.' };
  }
  if (!existsSync(inputHtml)) {
    return {
      ok: false,
      error: `No rendered HTML found at ${inputHtml}. Run the CLI flow first (`
        + 'paste a JD into Claude/Gemini → /career-ops pdf, or pre-render the template manually) '
        + 'so the dashboard has something to convert.',
    };
  }
  const result = await withCommandLock(() => runCommand('node', ['generate-pdf.mjs', inputHtml, outputPdf], root));
  return {
    ok: result.ok,
    output: outputPdf,
    stdout: (result.stdout || '').slice(-2000),
    stderr: (result.stderr || '').slice(-2000),
    durationMs: result.durationMs,
  };
}

// ── User-message composers for the surfaced modes ──────────────────────────

/**
 * modes/interview-prep.md inputs: company + role (required); optionally a
 * prior evaluation report (we'll auto-load the latest one matching the
 * (company, role) pair if present).
 */
function composeInterviewPrepMessage(body, root) {
  const company = String(body.company || '').trim();
  const role = String(body.role || '').trim();
  const reportPath = body.report_path ? safeJoin(root, String(body.report_path)) : null;
  const lines = [
    `COMPANY: ${company || '(not specified)'}`,
    `ROLE: ${role || '(not specified)'}`,
  ];
  if (reportPath && existsSync(reportPath)) {
    lines.push('', `PRIOR EVALUATION REPORT (${body.report_path}):`, '', readFileSync(reportPath, 'utf8'));
  } else {
    // Best-effort: pull the most recent report whose filename contains the
    // company slug. Avoids forcing the UI to know which report to attach.
    const reportsDir = join(root, 'reports');
    if (existsSync(reportsDir)) {
      const slug = simpleSlug(company);
      const matches = readdirSync(reportsDir)
        .filter((f) => f.endsWith('.md') && f.includes(slug))
        .sort()
        .reverse();
      if (matches[0]) {
        lines.push('', `LATEST MATCHING REPORT (${matches[0]}):`, '',
          readFileSync(join(reportsDir, matches[0]), 'utf8'));
      }
    }
  }
  if (body.context) lines.push('', `EXTRA CONTEXT:`, '', String(body.context));
  return lines.join('\n');
}

/**
 * modes/followup.md inputs: company + role + days-since-applied + status
 * (Applied / Responded / Interview / etc.). Returns drafted follow-up
 * message in the appropriate tone.
 */
function composeFollowupMessage(body) {
  return [
    `COMPANY: ${body.company || '(not specified)'}`,
    `ROLE: ${body.role || '(not specified)'}`,
    `STATUS: ${body.status || 'Applied'}`,
    body.days_since_applied != null ? `DAYS SINCE APPLIED: ${body.days_since_applied}` : '',
    body.last_interaction ? `LAST INTERACTION: ${body.last_interaction}` : '',
    body.contact_name ? `CONTACT: ${body.contact_name}` : '',
    body.context ? `CONTEXT: ${body.context}` : '',
    '',
    'Draft a concise, professional follow-up message in the candidate\'s voice.',
  ].filter(Boolean).join('\n');
}

/**
 * modes/ofertas.md compares 2–4 evaluation reports and outputs a 10-dim
 * scoring matrix + recommendation. The UI passes report paths; we load each
 * report's full content and ship them as the user message.
 */
function composeCompareMessage(body, root) {
  const ids = Array.isArray(body.report_paths) ? body.report_paths.slice(0, 6) : [];
  if (ids.length < 2) {
    throw new HttpError(400, 'Provide at least 2 report_paths to compare');
  }
  const sections = [];
  for (const rel of ids) {
    const full = safeJoin(root, String(rel));
    if (!full || !existsSync(full)) {
      sections.push(`### ${rel}\n\n[report not found]`);
      continue;
    }
    sections.push(`### ${rel}\n\n${readFileSync(full, 'utf8')}`);
  }
  return [
    `COMPARE THESE EVALUATION REPORTS AND PRODUCE A 10-DIMENSION SCORING MATRIX + FINAL RECOMMENDATION.`,
    '',
    sections.join('\n\n---\n\n'),
  ].join('\n');
}

// ── /jds — JD library browser ──────────────────────────────────────────

async function listJdsFolder(root) {
  const dir = join(root, 'jds');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (!['.txt', '.md', '.html'].includes(ext)) continue;
    const full = join(dir, e.name);
    const s = await stat(full);
    out.push({
      name: e.name,
      path: `jds/${e.name}`,
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
    });
  }
  out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return out;
}

async function readJdFile(root, relativePath) {
  if (!relativePath || !relativePath.startsWith('jds/')) {
    throw new HttpError(400, 'path must start with jds/');
  }
  const full = safeJoin(root, relativePath);
  if (!full || !existsSync(full)) throw new HttpError(404, 'JD file not found');
  return {
    path: relativePath,
    content: await readFile(full, 'utf8'),
  };
}

// ── /generate-latex — LaTeX CV variant ─────────────────────────────────

/**
 * Wrapper around generate-latex.mjs. Like generate-pdf.mjs it's a CLI script
 * that auto-runs on import (no exported function), so we shell out via
 * execFile rather than importing.
 */
async function generateLatexCv(body, root) {
  const inputTex = String(body.tex_path || '').trim();
  const outputPdfRaw = String(body.output_pdf || '').trim();
  if (!inputTex) {
    return { ok: false, error: 'tex_path is required (path to a .tex file rendered by the agent)' };
  }
  const fullInput = safeJoin(root, inputTex);
  if (!fullInput || !existsSync(fullInput)) {
    return { ok: false, error: `Tex file not found: ${inputTex}` };
  }
  // output_pdf is optional; when given it must also stay inside root so the
  // user can't write the rendered PDF anywhere on disk via path traversal.
  let fullOutput = null;
  if (outputPdfRaw) {
    fullOutput = safeJoin(root, outputPdfRaw);
    if (!fullOutput) {
      return { ok: false, error: 'output_pdf must resolve inside the project root.' };
    }
  }
  const args = ['generate-latex.mjs', fullInput];
  if (fullOutput) args.push(fullOutput);
  const result = await withCommandLock(() => runCommand('node', args, root));
  return {
    ok: result.ok,
    stdout: (result.stdout || '').slice(-2000),
    stderr: (result.stderr || '').slice(-2000),
    durationMs: result.durationMs,
  };
}

// ── End surfaced-mode helpers ──────────────────────────────────────────

// ── CV Studio — full tailored-CV pipeline ──────────────────────────────────
//
// End-to-end flow: agent reads cv.md + modes/pdf.md + templates/cv-template.html
// → fills every {{PLACEHOLDER}} with content tailored to the JD → we save the
// HTML → shell out to generate-pdf.mjs → return PDF + HTML paths. Streams
// progress as SSE so the UI can show "Tailoring → Rendering → Generating PDF".
//
// Placeholders the agent must fill (from templates/cv-template.html):
//   {{LANG}}                        e.g. en|es|de
//   {{NAME}} {{PHONE}} {{EMAIL}}    candidate identity (read from profile.yml)
//   {{LOCATION}} {{LINKEDIN_*}} {{PORTFOLIO_*}}
//   {{PAGE_WIDTH}}                  8.5in (US letter) | 8.27in (A4)
//   {{SECTION_*}}                   localized section titles
//   {{SUMMARY_TEXT}}                3-4 lines, keyword-dense for the JD
//   {{COMPETENCIES}}                <span> chips for 6-8 keyword phrases
//   {{EXPERIENCE}} {{PROJECTS}} {{EDUCATION}} {{CERTIFICATIONS}}
//                                    full HTML blocks rendered by the agent
//
// We do not pre-fill the template — the agent does. That preserves the
// original Career-Ops behavior where pdf.md instructs the model to handle
// keyword injection, bullet reordering, and competency-grid construction.

async function streamCvStudio({ req, res, body, root }) {
  // ── 1. Validate basics ────────────────────────────────────────────
  const jdText = String(body.jd_text || '').trim();
  if (jdText.length < 40) {
    sendJson(res, 400, {
      error: 'Job description is too short to tailor a CV.',
      hint: 'Paste the full JD into the dialog so the agent has enough signal to inject keywords.',
    });
    return;
  }
  const modelId = String(body.model_id || '').trim();
  let provider;
  try { provider = modelId ? getProvider(modelId) : await defaultProvider(); }
  catch (err) {
    const available = await listAvailableProviderIds();
    sendJson(res, 400, { error: String(err?.message || err), available_providers: available });
    return;
  }
  const avail = await provider.available();
  if (!avail.available) {
    sendJson(res, 503, { error: avail.reason || 'provider unavailable', hint: avail.hint });
    return;
  }

  // ── 2. Read context (cv.md, profile.yml, mode, shared, template) ──
  const language = String(body.language || 'en').toLowerCase().slice(0, 4);
  const ctx = readContextBundle(root, { language });
  let modeFile;
  try { modeFile = resolveModeFile(root, 'pdf', language); }
  catch (err) { sendJson(res, 400, { error: String(err?.message || err) }); return; }

  // The template is the structural reference the agent matches.
  const templatePath = join(root, 'templates', 'cv-template.html');
  let template = '';
  if (existsSync(templatePath)) template = await readFile(templatePath, 'utf8');
  if (!template) {
    sendJson(res, 500, { error: 'templates/cv-template.html missing — restore it from the original career-ops repo.' });
    return;
  }

  // Pull candidate identity from profile.yml so we generate {{PLACEHOLDERS}}-
  // free output filenames + stamp identity into the user message.
  const profileData = parseProfileYaml(ctx.profileYml);
  const candidateName = profileData.name || 'Candidate';
  const candidateSlug = simpleSlug(candidateName);
  const company = String(body.company || extractCompanyFromJd(jdText) || 'company').trim();
  const companySlug = simpleSlug(company);
  const date = new Date().toISOString().slice(0, 10);

  // Paper format: caller can override; otherwise infer from JD geography.
  const paper = String(body.paper || inferPaperFormat(jdText, profileData)).toLowerCase();
  if (!['letter', 'a4'].includes(paper)) {
    sendJson(res, 400, { error: 'paper must be "letter" or "a4"' });
    return;
  }

  // ── 3. Open the SSE stream ────────────────────────────────────────
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
    'connection': 'keep-alive',
  });
  res.write(': cv-studio-start\n\n');
  // CV Studio runs three sequential agent stages — tailoring (often 60-120 s)
  // + rendering + Playwright PDF. Long enough to outlast many proxy idle
  // timeouts, so emit a comment line every 20 s to keep the connection warm.
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); }
    catch { clearInterval(keepalive); }
  }, 20_000);
  const stopKeepalive = () => clearInterval(keepalive);

  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const ac = new AbortController();
  req.on('close', () => { ac.abort(); stopKeepalive(); });

  writeEvent('stage', { stage: 'tailoring', label: `Asking ${provider.label} to tailor your CV…` });

  // ── 4. Compose system prompt + user message ───────────────────────
  const baseSystem = composeSystemPrompt({
    shared: ctx.shared,
    profile: ctx.profile,
    modeText: modeFile.text,
    modeName: 'pdf',
    cv: ctx.cv,
    digest: ctx.digest,
  });
  // Append the template with explicit instruction so the agent matches its
  // structure exactly. We tell it NOT to wrap in code fences because some
  // models default to ```html … ``` which we'd then have to strip.
  const system = baseSystem
    + `\n\n═══════════════════════════════════════════════════════`
    + `\nCV TEMPLATE (output a complete HTML document with every {{PLACEHOLDER}} filled)`
    + `\n═══════════════════════════════════════════════════════`
    + `\n${template}`
    + `\n\nCANDIDATE IDENTITY (from config/profile.yml):`
    + `\n${ctx.profileYml.split('\n').slice(0, 80).join('\n')}`
    + `\n\nFINAL OUTPUT RULES:`
    + `\n- Output ONLY the complete <!DOCTYPE html>… HTML document.`
    + `\n- Do NOT wrap in markdown code fences.`
    + `\n- Replace EVERY {{PLACEHOLDER}} (LANG, NAME, PHONE, EMAIL, LINKEDIN_URL, LINKEDIN_DISPLAY, PORTFOLIO_URL, PORTFOLIO_DISPLAY, LOCATION, PAGE_WIDTH, SECTION_*, SUMMARY_TEXT, COMPETENCIES, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS).`
    + `\n- PAGE_WIDTH = "${paper === 'letter' ? '8.5in' : '8.27in'}".`
    + `\n- LANG = "${language}".`
    + `\n- Inject 6-8 keyword phrases from the JD into COMPETENCIES (as <span class="competency-pill"> chips matching the template's existing markup).`
    + `\n- Reorder Experience bullets and Projects so the most JD-relevant items come first; never invent metrics.`
    + `\n- Preserve all <style> rules from the template verbatim.`
    + `\n- Single-column, ATS-clean. No images in the body.`;

  const userMessage = composeJdMessage({
    jdText,
    jdUrl: body.jd_url,
    extraContext: `Company: ${company}\nCandidate: ${candidateName}\nPaper: ${paper}\nLanguage: ${language}`,
  });

  // ── 5. Call the model — capture full HTML via the same streaming hook
  //                          we use for /api/evaluate. We stream coarse
  //                          char-count progress to the UI rather than the
  //                          raw HTML markup (which would flood it).
  let html = '';
  let chunks = 0;
  try {
    const result = await provider.run({
      system,
      user: userMessage,
      signal: ac.signal,
      maxOutputTokens: 8192,
      temperature: 0.3,
      onToken: (evt) => {
        html += evt.chunk;
        chunks += 1;
        if (chunks % 6 === 0) {                            // throttle UI updates
          writeEvent('progress', { chars: html.length });
        }
      },
    });
    void result;
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : String(err?.message || err);
    const hint = err instanceof ProviderError ? err.hint : undefined;
    writeEvent('error', { stage: 'tailoring', message, hint, provider: provider.id });
    stopKeepalive();
    res.end();
    return;
  }

  // ── 6. Sanitize HTML — strip code fences, smart-quote-clean ──────
  html = stripCodeFences(html);
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    writeEvent('error', {
      stage: 'tailoring',
      message: 'Agent did not return a complete HTML document.',
      hint: 'Try a different model or click Re-run. The output should start with <!DOCTYPE html>.',
      preview: html.slice(0, 400),
    });
    stopKeepalive();
    res.end();
    return;
  }
  // Spot any remaining placeholders the agent forgot to fill — surface as a
  // warning but proceed (some are non-critical like LINKEDIN_DISPLAY).
  const unfilled = [...new Set((html.match(/\{\{[A-Z_]+\}\}/g) || []))];
  if (unfilled.length) writeEvent('warning', { stage: 'tailoring', message: `Some placeholders left unfilled: ${unfilled.join(', ')}` });

  // ── 7. Write HTML to output/ ──────────────────────────────────────
  writeEvent('stage', { stage: 'rendering', label: 'Writing HTML and copying fonts…' });
  const outDir = join(root, 'output');
  await mkdir(outDir, { recursive: true });
  const slug = `cv-${candidateSlug}-${companySlug}-${date}`;
  const htmlPath = join(outDir, `${slug}.html`);
  const pdfPath = join(outDir, `${slug}.pdf`);
  await writeFile(htmlPath, html, 'utf8');

  // The template references `./fonts/*.woff2` — generate-pdf.mjs sets the
  // base URL to the HTML's directory, so make sure the fonts are reachable.
  // We don't copy them; we rely on the template's relative path (works when
  // generate-pdf.mjs sets baseURL to the html file's parent — verified).

  // ── 8. Run Playwright via generate-pdf.mjs ────────────────────────
  writeEvent('stage', { stage: 'pdf', label: 'Running Playwright to render PDF…' });
  const pdfRun = await withCommandLock(() => runCommand(
    'node',
    ['generate-pdf.mjs', htmlPath, pdfPath, `--format=${paper}`],
    root,
  ));
  if (!pdfRun.ok) {
    writeEvent('error', {
      stage: 'pdf',
      message: 'PDF generation failed',
      hint: pdfRun.timeout ? 'Playwright timed out — try again.' : 'See stderr for details.',
      stderr: (pdfRun.stderr || '').slice(-2000),
    });
    stopKeepalive();
    res.end();
    return;
  }

  const pdfStat = existsSync(pdfPath) ? (await stat(pdfPath)) : null;

  // ── 9. Optional: flip the application's PDF flag if (company,role) match
  if (body.application_number && Number.isFinite(Number(body.application_number))) {
    try {
      const appsPath = join(root, 'data', 'applications.md');
      const current = await readFile(appsPath, 'utf8');
      const next = mutateApplicationsMarkdown(current, Number(body.application_number), (cells) => {
        cells[6] = '✅';                                    // PDF column
      });
      await writeFile(appsPath, next, 'utf8');
    } catch { /* non-fatal — UI shows the PDF link regardless */ }
  }

  writeEvent('done', {
    html_path: relative(root, htmlPath).replace(/\\/g, '/'),
    pdf_path: relative(root, pdfPath).replace(/\\/g, '/'),
    candidate: candidateSlug,
    company: companySlug,
    paper,
    size_bytes: pdfStat?.size || 0,
    provider: provider.id,
    duration_ms: pdfRun.durationMs,
    pdf_stdout: (pdfRun.stdout || '').slice(-1500),
  });
  stopKeepalive();
  res.end();
}

// ── CV Studio helpers ──────────────────────────────────────────────────

function stripCodeFences(text) {
  let s = String(text || '').trim();
  // Common markdown wrappers the model occasionally emits.
  const m = s.match(/^```(?:html|HTML)?\n?([\s\S]*?)\n?```\s*$/);
  if (m) s = m[1].trim();
  return s;
}

function simpleSlug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unknown';
}

/** Pull `name:` / `email:` from profile.yml without a YAML parser dep. */
function parseProfileYaml(raw) {
  if (!raw || /not found/i.test(raw)) return {};
  const out = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s*:\s*"?([^"#]+?)"?\s*(?:#.*)?$/);
    if (m && /^(name|email|location|phone|country)$/i.test(m[1])) {
      out[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return out;
}

/** US/Canada → letter, everything else → A4. Uses simple location keywords. */
function inferPaperFormat(jdText, profile) {
  const text = `${jdText} ${profile?.location || ''} ${profile?.country || ''}`.toLowerCase();
  if (/\b(usa|united states|us|canada|toronto|new york|san francisco|seattle|austin|boston)\b/.test(text)) return 'letter';
  return 'a4';
}

/** Best-effort company name extraction for the filename. Looks for "at X" / "X is hiring". */
function extractCompanyFromJd(jdText) {
  const t = String(jdText).slice(0, 2000);
  const m = t.match(/\b(?:at|join|with)\s+([A-Z][\w&.\- ]{1,40}?)(?:[,.\n]|\s+is hiring|\s+is looking)/);
  return m ? m[1].trim() : '';
}

// ── End CV Studio ──────────────────────────────────────────────────────

// ── End Phase K endpoints ───────────────────────────────────────────────────

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.yaml':
    case '.yml':
      return 'application/x-yaml; charset=utf-8';
    case '.tsv':
      return 'text/tab-separated-values; charset=utf-8';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

const DASHBOARD_DIR = join(PROJECT_ROOT, 'dashboard-web', 'out');
const DASHBOARD_ALLOWED = new Set([
  '.html', '.css', '.js', '.map', '.json', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
]);

/**
 * Serve the statically exported Next.js dashboard at /dashboard/*.
 *
 * basePath: '/dashboard' in next.config.ts means every asset reference inside
 * the build is prefixed with /dashboard, so we strip that prefix here and
 * resolve into dashboard-web/out/. Directory paths fall through to
 * <dir>/index.html so /dashboard/sources/ → out/sources/index.html.
 *
 * Returns true if the request was handled (anything starting with /dashboard).
 */
async function serveDashboard(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/dashboard')) return false;

  if (!existsSync(DASHBOARD_DIR)) {
    sendText(res, 503,
      'Dashboard not built. Run `npm run dashboard:build:export` from the project root.',
      'text/plain; charset=utf-8',
    );
    return true;
  }

  // Strip the basePath. /dashboard → '', /dashboard/ → '/', /dashboard/foo → '/foo'.
  let rest = url.pathname.slice('/dashboard'.length) || '/';
  if (rest === '/') rest = '/index.html';
  else if (rest.endsWith('/')) rest = `${rest}index.html`;

  // If the path has no extension, try `<path>.html` first (sub-routes from
  // Next's static export sometimes generate /sources.html alongside /sources/).
  const tryPaths = [rest];
  if (!extname(rest)) tryPaths.push(`${rest}.html`, `${rest}/index.html`);

  for (const candidate of tryPaths) {
    const filePath = safeJoin(DASHBOARD_DIR, candidate.slice(1));
    if (!filePath) continue;
    const ext = extname(filePath).toLowerCase();
    if (!DASHBOARD_ALLOWED.has(ext)) continue;
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath);
      res.writeHead(200, {
        ...dashboardHeaders(),
        'content-type': contentType(filePath),
        // Hashed Next assets (under /_next/static/) are cache-friendly. HTML
        // is not — we want fresh navigation responses every time.
        'cache-control': candidate.includes('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      res.end(content);
      return true;
    } catch {
      /* try next candidate */
    }
  }

  // Serve the 404 page if available, else a plain message.
  const fourOhFour = safeJoin(DASHBOARD_DIR, '404.html');
  if (fourOhFour && existsSync(fourOhFour)) {
    const content = await readFile(fourOhFour);
    res.writeHead(404, { ...dashboardHeaders(), 'content-type': 'text/html; charset=utf-8' });
    res.end(content);
  } else {
    sendText(res, 404, 'Not found');
  }
  return true;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);

  // Phase M7 — root redirects to the Next.js dashboard. The legacy vanilla
  // `web/` console stays for now (still served from /index.html if someone
  // links to it directly), but the front door is /dashboard/.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(302, { ...commonHeaders(), location: '/dashboard/' });
    res.end();
    return;
  }

  let baseDir = WEB_DIR;
  let relativePath = pathname.slice(1);
  let allowed = new Set(['.html', '.css', '.js', '.map', '.json']);

  if (pathname.startsWith('/assets/')) {
    baseDir = PROJECT_ROOT;
    relativePath = pathname.slice('/assets/'.length);
    allowed = new Set(['.jpg', '.jpeg', '.png', '.svg', '.gif', '.webp', '.pdf', '.md', '.txt', '.yml', '.yaml', '.tsv']);
  }

  const filePath = safeJoin(baseDir, relativePath);
  if (!filePath || !allowed.has(extname(filePath).toLowerCase())) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      ...commonHeaders(),
      'content-type': contentType(filePath),
      'cache-control': 'no-store',
    });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function createCareerOpsServer({ root = PROJECT_ROOT } = {}) {
  return createServer(async (req, res) => {
    const requestPath = req.url || '/';

    if (requestPath.startsWith('/api/') && !isLocalRequest(req)) {
      sendJson(res, 403, { error: 'This API is available only from localhost' });
      return;
    }

    try {
      if (requestPath.startsWith('/api/') && await handleApi(req, res, root)) return;
      if (await serveDashboard(req, res)) return;
      await serveStatic(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}

function parsePort() {
  const flagIndex = process.argv.indexOf('--port');
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
    return Number(process.argv[flagIndex + 1]);
  }
  return Number(process.env.CAREER_OPS_WEB_PORT || 5177);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parsePort();
  const server = createCareerOpsServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Career-Ops web app running at http://127.0.0.1:${port}`);
    console.log('Localhost-only mode enabled. Use the browser UI to manage setup, tracker, pipeline, and operations.');
  });
}
