// tests/agents.test.mjs
//
// Phase K0 — model abstraction layer.
//
// Goals:
//  1. Pure helpers (composeSystemPrompt / parseScoreSummary / nextReportNumber
//     / saveReport) are deterministic and handle edge cases.
//  2. Each provider's `available()` reflects env state correctly.
//  3. A mocked provider can stream tokens through the run() interface.
//  4. The HTTP /api/agents endpoint returns a list with availability resolved.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import {
  composeSystemPrompt,
  composeJdMessage,
  parseScoreSummary,
  stripScoreSummary,
  nextReportNumber,
  slugify,
  saveReport,
  resolveModeFile,
  readContextBundle,
} from '../scanners/agents/_prompt.mjs';
import { emitFakeStream, ProviderError } from '../scanners/agents/_base.mjs';
import gemini from '../scanners/agents/gemini.mjs';
import openai from '../scanners/agents/openai.mjs';
import claudeCode from '../scanners/agents/claude-code.mjs';
import { discoverProviders, getProvider, knownProviderIds } from '../scanners/agents/registry.mjs';
import { createCareerOpsServer } from '../web-server.mjs';

// ── Pure helper tests ──────────────────────────────────────────────────

test('composeSystemPrompt — includes every section in the canonical order', () => {
  const out = composeSystemPrompt({
    shared: 'SHARED_X',
    profile: 'PROFILE_X',
    modeText: 'MODE_X',
    modeName: 'oferta',
    cv: 'CV_X',
    digest: 'DIGEST_X',
  });
  // Order matters: shared → profile → mode → cv → digest. The mode file
  // refers to "previous sections", so we keep the layout deterministic.
  const idx = (s) => out.indexOf(s);
  assert.ok(idx('SHARED_X') < idx('PROFILE_X'), 'shared before profile');
  assert.ok(idx('PROFILE_X') < idx('MODE_X'), 'profile before mode');
  assert.ok(idx('MODE_X') < idx('CV_X'), 'mode before cv');
  assert.ok(idx('CV_X') < idx('DIGEST_X'), 'cv before digest');
  assert.match(out, /mode "oferta"/);
  assert.match(out, /SCORE_SUMMARY/);                        // operating-rules block must mention it
});

test('composeJdMessage — handles url + extraContext optionality', () => {
  const a = composeJdMessage({ jdText: 'JD_BODY' });
  assert.match(a, /JD_BODY/);
  assert.ok(!a.includes('JOB POSTING URL'));
  const b = composeJdMessage({ jdText: 'JD_BODY', jdUrl: 'https://x' });
  assert.match(b, /JOB POSTING URL: https:\/\/x/);
  const c = composeJdMessage({ jdText: 'JD', extraContext: 'PREVIOUS_REPORT' });
  assert.match(c, /ADDITIONAL CONTEXT/);
  assert.match(c, /PREVIOUS_REPORT/);
});

test('parseScoreSummary — extracts every field, returns null on no block', () => {
  const text = `Block A...

---SCORE_SUMMARY---
COMPANY: Careem
ROLE: Senior Backend Engineer
SCORE: 4.2
ARCHETYPE: FDE
LEGITIMACY: High Confidence
---END_SUMMARY---`;
  const parsed = parseScoreSummary(text);
  assert.equal(parsed.company, 'Careem');
  assert.equal(parsed.role, 'Senior Backend Engineer');
  assert.equal(parsed.score, 4.2);
  assert.equal(parsed.scoreRaw, '4.2');
  assert.equal(parsed.archetype, 'FDE');
  assert.equal(parsed.legitimacy, 'High Confidence');
  assert.equal(parseScoreSummary('Just a body. No summary.'), null);
});

test('parseScoreSummary — tolerates extra whitespace and missing fields', () => {
  const text = `---SCORE_SUMMARY---

COMPANY:    Acme
ROLE:    Engineer
SCORE: 3.5/5
---END_SUMMARY---`;
  const parsed = parseScoreSummary(text);
  assert.equal(parsed.company, 'Acme');
  assert.equal(parsed.score, 3.5);          // strips "/5" suffix
  assert.equal(parsed.archetype, null);
  assert.equal(parsed.legitimacy, null);
});

test('stripScoreSummary — removes the block while preserving everything else', () => {
  const body = '## Block A\nbody\n\n---SCORE_SUMMARY---\nCOMPANY: X\n---END_SUMMARY---';
  const out = stripScoreSummary(body);
  assert.match(out, /Block A/);
  assert.ok(!/SCORE_SUMMARY/.test(out));
});

test('slugify — handles diacritics, punctuation, length cap', () => {
  assert.equal(slugify('Careem Networks LLC'), 'careem-networks-llc');
  // NFKD strips the combining acute, so "Café" → "Cafe" → slug "cafe-co".
  assert.equal(slugify('Café & Co.'), 'cafe-co');
  assert.equal(slugify('München AG'), 'munchen-ag');
  // Length cap (60) — ensure long names don't blow up filenames.
  const long = 'a'.repeat(120);
  assert.equal(slugify(long).length, 60);
});

test('nextReportNumber + saveReport — round-trip matches gemini-eval naming', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-reports-'));
  const reportsDir = join(dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  // Seed an existing report so the next number bumps past it.
  writeFileSync(join(reportsDir, '041-old-2026-01-01.md'), '# old', 'utf8');

  assert.equal(nextReportNumber(reportsDir), '042');

  const { path, number, company, slug, filename } = saveReport({
    reportsDir,
    rootDir: dir,
    body: '## Block A\n\nbody',
    summary: { company: 'Careem', role: 'SWE', scoreRaw: '4.2/5', archetype: 'FDE', legitimacy: 'High Confidence' },
    toolLabel: 'Career-Ops · Agent layer',
    modelLabel: 'gemini-2.0-flash',
  });
  assert.equal(number, '042');
  assert.equal(company, 'Careem');
  assert.equal(slug, 'careem');
  assert.match(filename, /^042-careem-\d{4}-\d{2}-\d{2}\.md$/);
  assert.equal(path.startsWith('reports/042-careem-'), true);

  const written = readFileSync(join(reportsDir, filename), 'utf8');
  assert.match(written, /\*\*Score:\*\* 4\.2\/5/);
  assert.match(written, /\*\*Legitimacy:\*\* High Confidence/);
  assert.match(written, /\*\*PDF:\*\* pending/);
  assert.match(written, /\*\*Model:\*\* gemini-2\.0-flash/);
  assert.match(written, /## Block A/);
  rmSync(dir, { recursive: true, force: true });
});

test('resolveModeFile — falls back from {lang}/{mode}.md to {mode}.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-modes-'));
  mkdirSync(join(dir, 'modes', 'de'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'oferta.md'), 'EN MODE', 'utf8');
  writeFileSync(join(dir, 'modes', 'de', 'oferta.md'), 'DE MODE', 'utf8');

  assert.equal(resolveModeFile(dir, 'oferta', '').text, 'EN MODE');
  assert.equal(resolveModeFile(dir, 'oferta', 'en').text, 'EN MODE');     // 'en' uses base, not modes/en/
  assert.equal(resolveModeFile(dir, 'oferta', 'de').text, 'DE MODE');
  // Missing language gracefully falls back.
  assert.equal(resolveModeFile(dir, 'oferta', 'fr').text, 'EN MODE');
  // Missing mode entirely throws.
  assert.throws(() => resolveModeFile(dir, 'unknown', ''), /not found/);
  rmSync(dir, { recursive: true, force: true });
});

test('readContextBundle — tolerates a fresh workspace with nothing in it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-ctx-'));
  const ctx = readContextBundle(dir);
  // None of these exist — the bundle should hand back placeholders, not throw.
  assert.match(ctx.shared, /not found/);
  assert.match(ctx.cv, /not found/);
  rmSync(dir, { recursive: true, force: true });
});

test('emitFakeStream — chunks long text by paragraph, single emit on short', () => {
  const events = [];
  emitFakeStream('short text', (e) => events.push(e));
  assert.equal(events.length, 1);
  assert.equal(events[0].chunk, 'short text');

  events.length = 0;
  const long = ('a'.repeat(900) + '\n\n' + 'b'.repeat(900));
  emitFakeStream(long, (e) => events.push(e));
  assert.equal(events.length, 2);
  assert.match(events[0].chunk, /^a+/);
  assert.match(events[1].chunk, /^b+/);
});

// ── Provider availability tests ────────────────────────────────────────

test('gemini.available — reflects GEMINI_API_KEY presence', async () => {
  const before = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let avail = await gemini.available();
  assert.equal(avail.available, false);
  assert.match(avail.reason, /GEMINI_API_KEY/);

  process.env.GEMINI_API_KEY = 'fake-key-for-test';
  avail = await gemini.available();
  assert.equal(avail.available, true);

  if (before == null) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = before;
});

test('openai.available — flags missing key with actionable hint', async () => {
  const before = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const avail = await openai.available();
  assert.equal(avail.available, false);
  assert.match(avail.reason, /OPENAI_API_KEY/);
  assert.match(avail.hint, /\.env/);
  if (before != null) process.env.OPENAI_API_KEY = before;
});

test('claude-code.available — non-throwing when binary missing', async () => {
  // We don't assert true/false because some test envs have `claude` on PATH.
  // We DO assert the function never throws and always returns an object.
  const avail = await claudeCode.available();
  assert.equal(typeof avail.available, 'boolean');
  if (!avail.available) {
    assert.equal(typeof avail.reason, 'string');
  }
});

test('ProviderError carries id, retriable flag, and hint', () => {
  const err = new ProviderError('gemini', 'rate limited', { retriable: true, hint: 'wait 60s' });
  assert.equal(err.providerId, 'gemini');
  assert.equal(err.retriable, true);
  assert.equal(err.hint, 'wait 60s');
  assert.match(err.message, /gemini.*rate limited/);
});

// ── Registry tests ─────────────────────────────────────────────────────

test('registry — knownProviderIds and getProvider are consistent', () => {
  assert.deepEqual(knownProviderIds, ['claude-code', 'gemini', 'openai']);
  assert.equal(getProvider('gemini').id, 'gemini');
  assert.throws(() => getProvider('bogus'), /Unknown provider/);
});

test('discoverProviders — returns all 3 with shape stable', async () => {
  const list = await discoverProviders();
  assert.equal(list.length, 3);
  for (const p of list) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.label, 'string');
    assert.equal(typeof p.family, 'string');
    assert.equal(typeof p.available, 'boolean');
    assert.equal(typeof p.defaultModel, 'string');
    assert.equal(typeof p.costsMoney, 'boolean');
  }
});

// ── HTTP integration ───────────────────────────────────────────────────

test('GET /api/agents — returns list with availability resolved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-http-'));
  // Minimal scaffolding so createCareerOpsServer + computeOverview don't crash.
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf8');
  writeFileSync(join(dir, 'portals.yml'), 'sources: {}\n', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n', 'utf8');
  writeFileSync(join(dir, 'data', 'applications.md'), '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n', 'utf8');

  const server = createCareerOpsServer({ root: dir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 3);
    const ids = list.map((p) => p.id);
    assert.deepEqual(ids.sort(), ['claude-code', 'gemini', 'openai']);
    for (const p of list) {
      assert.equal(typeof p.available, 'boolean');
      assert.equal(typeof p.label, 'string');
    }
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
