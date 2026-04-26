// tests/base-utils.test.mjs — direct unit tests for scanner base utilities.
//
// Goal: pin down behavior of utilities every adapter relies on. Uncovered
// regressions in any of these silently corrupt every adapter at once, so
// tight tests here have outsized leverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripHtml,
  slugify,
  buildTitleFilter,
  canonicalUrl,
  validateEmploymentType,
  parseSalaryText,
  inferRemote,
  inferRegions,
  RateLimiter,
  CircuitBreaker,
  pAllLimit,
} from '../scanners/_base.mjs';

// ── stripHtml ──────────────────────────────────────────────────────────

test('stripHtml removes tags and collapses whitespace', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripHtml('<div>\n  multi\n  line\n</div>'), 'multi line');
});

test('stripHtml handles nullish input', () => {
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(''), '');
});

test('stripHtml strips even malformed tags', () => {
  assert.equal(stripHtml('<<>not really> a < b'), 'not really> a < b');
});

// ── slugify ────────────────────────────────────────────────────────────

test('slugify lowercases and replaces non-word chars', () => {
  assert.equal(slugify('Senior Backend Engineer'), 'senior-backend-engineer');
  assert.equal(slugify('  Hello,  World!  '), 'hello-world');
});

test('slugify handles unicode by stripping non-ASCII', () => {
  // The current implementation strips non-\w characters — accents/CJK go away.
  // This pins that behavior so a future "preserve unicode" change is intentional.
  assert.equal(slugify('Café & Co'), 'caf-co');
  assert.equal(slugify('日本語ジョブ'), '');
});

test('slugify collapses multiple separators', () => {
  assert.equal(slugify('foo---bar___baz'), 'foo-bar___baz');
  assert.equal(slugify('-leading-and-trailing-'), 'leading-and-trailing');
});

// ── buildTitleFilter ───────────────────────────────────────────────────

test('buildTitleFilter empty positives = pass-all (sans negatives)', () => {
  const fn = buildTitleFilter({ positive: [], negative: ['junior'] });
  assert.equal(fn('Senior Engineer'), true);
  assert.equal(fn('Junior Developer'), false);
  assert.equal(fn(''), false);
});

test('buildTitleFilter requires at least one positive match', () => {
  const fn = buildTitleFilter({ positive: ['ai', 'ml'], negative: [] });
  assert.equal(fn('AI Engineer'), true);
  assert.equal(fn('Senior ML Researcher'), true);
  assert.equal(fn('Frontend Developer'), false);
});

test('buildTitleFilter rejects on any negative match even if positive matches', () => {
  const fn = buildTitleFilter({ positive: ['engineer'], negative: ['junior', 'intern'] });
  assert.equal(fn('Senior Engineer'), true);
  assert.equal(fn('Junior Engineer'), false);
  assert.equal(fn('Engineering Intern'), false);
});

test('buildTitleFilter is case-insensitive on both sides', () => {
  const fn = buildTitleFilter({ positive: ['AI'], negative: ['JUNIOR'] });
  assert.equal(fn('senior ai engineer'), true);
  assert.equal(fn('JUNIOR AI engineer'), false);
});

// ── canonicalUrl ───────────────────────────────────────────────────────

test('canonicalUrl strips utm and tracking params', () => {
  const u = canonicalUrl('https://example.com/jobs/123?utm_source=linkedin&id=42&fbclid=abc');
  assert.match(u, /id=42/);
  assert.doesNotMatch(u, /utm_source/);
  assert.doesNotMatch(u, /fbclid/);
});

test('canonicalUrl drops fragment and lowercases host', () => {
  const u = canonicalUrl('HTTPS://Example.COM/jobs/123#apply');
  assert.match(u, /^https:\/\/example\.com/);
  assert.doesNotMatch(u, /#apply/);
});

test('canonicalUrl handles invalid input gracefully', () => {
  // Should not throw on garbage
  assert.doesNotThrow(() => canonicalUrl('not a url'));
  assert.doesNotThrow(() => canonicalUrl(''));
  assert.doesNotThrow(() => canonicalUrl(null));
});

// ── validateEmploymentType ─────────────────────────────────────────────

test('validateEmploymentType normalizes common variants', () => {
  assert.equal(validateEmploymentType('Full-time'), 'FULL_TIME');
  assert.equal(validateEmploymentType('full time'), 'FULL_TIME');
  assert.equal(validateEmploymentType('part-time'), 'PART_TIME');
  // Both CONTRACT and CONTRACTOR are in the enum; bare "Contract" matches
  // CONTRACT exactly. Variants like "contracting" fall through to /CONTRACT/
  // and resolve to CONTRACTOR.
  assert.equal(validateEmploymentType('Contract'), 'CONTRACT');
  assert.equal(validateEmploymentType('contracting'), 'CONTRACTOR');
  assert.equal(validateEmploymentType('intern'), 'INTERN');
  assert.equal(validateEmploymentType(''), null);
  assert.equal(validateEmploymentType(null), null);
  assert.equal(validateEmploymentType('chairman'), null);
});

// ── parseSalaryText ────────────────────────────────────────────────────

test('parseSalaryText extracts ranges with currency', () => {
  const r = parseSalaryText('$120,000 - $150,000');
  assert.equal(r.min, 120000);
  assert.equal(r.max, 150000);
  assert.equal(r.currency, 'USD');
});

test('parseSalaryText handles k-suffix shorthand', () => {
  const r = parseSalaryText('$80k–120k');
  assert.equal(r.min, 80000);
  assert.equal(r.max, 120000);
});

test('parseSalaryText returns null on no numbers', () => {
  assert.equal(parseSalaryText('Competitive'), null);
  assert.equal(parseSalaryText(''), null);
  assert.equal(parseSalaryText(null), null);
});

// ── inferRemote / inferRegions ─────────────────────────────────────────

test('inferRemote detects common remote phrasings', () => {
  assert.equal(inferRemote('Remote · Anywhere'), true);
  assert.equal(inferRemote('Work from home'), true);
  assert.equal(inferRemote('Fully Remote'), true);
  assert.equal(inferRemote('Distributed team'), true);
  assert.equal(inferRemote('Onsite, NYC'), false);
  assert.equal(inferRemote(''), false);
});

test('inferRegions tags Pakistan and Gulf cities', () => {
  assert.deepEqual(inferRegions('Lahore, Pakistan').sort(), ['pakistan']);
  assert.deepEqual(inferRegions('Dubai, UAE').sort(), ['gulf', 'uae']);
  assert.deepEqual(inferRegions('Riyadh', 'Saudi Arabia').sort(), ['gulf', 'saudi-arabia']);
  // Worldwide-remote fallback when nothing else matches
  assert.deepEqual(inferRegions('Anywhere'), ['worldwide-remote']);
  assert.deepEqual(inferRegions('').length, 0);
});

// ── RateLimiter ─────────────────────────────────────────────────────────

test('RateLimiter spaces out requests to the same host', async () => {
  const rl = new RateLimiter({ minIntervalMs: 100 });
  const url = 'https://throttled.example/test';
  const t0 = Date.now();
  const r1 = await rl.acquire(url);
  r1();
  const r2 = await rl.acquire(url);
  r2();
  const elapsed = Date.now() - t0;
  // Second acquire must wait at least minIntervalMs.
  assert.ok(elapsed >= 95, `expected >=95 ms, got ${elapsed}`);
});

test('RateLimiter does not throttle different hosts', async () => {
  const rl = new RateLimiter({ minIntervalMs: 200 });
  const t0 = Date.now();
  const r1 = await rl.acquire('https://host-a.example/x');
  r1();
  const r2 = await rl.acquire('https://host-b.example/y');
  r2();
  const elapsed = Date.now() - t0;
  // Different hosts → near-zero wait.
  assert.ok(elapsed < 100, `expected <100 ms, got ${elapsed}`);
});

// ── CircuitBreaker ──────────────────────────────────────────────────────

test('CircuitBreaker opens after threshold failures and recovers on success', () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  assert.equal(cb.isOpen('a'), false);
  cb.recordFailure('a');
  cb.recordFailure('a');
  assert.equal(cb.isOpen('a'), false);
  cb.recordFailure('a');
  assert.equal(cb.isOpen('a'), true);
  cb.recordSuccess('a');
  assert.equal(cb.isOpen('a'), false);
});

test('CircuitBreaker tracks per-key state independently', () => {
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
  cb.recordFailure('a'); cb.recordFailure('a');
  cb.recordFailure('b');
  assert.equal(cb.isOpen('a'), true);
  assert.equal(cb.isOpen('b'), false);
});

// ── pAllLimit ───────────────────────────────────────────────────────────

test('pAllLimit bounds parallelism and returns ordered results', async () => {
  const items = [1, 2, 3, 4, 5];
  let live = 0, peak = 0;
  const results = await pAllLimit(items, 2, async (x) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 20));
    live--;
    return x * 2;
  });
  assert.ok(peak <= 2, `expected peak <= 2, got ${peak}`);
  assert.deepEqual(results.map((r) => r.value), [2, 4, 6, 8, 10]);
  assert.ok(results.every((r) => r.ok));
});

test('pAllLimit captures errors per item', async () => {
  const results = await pAllLimit([1, 2, 3], 2, async (x) => {
    if (x === 2) throw new Error('boom');
    return x;
  });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error.message, /boom/);
  assert.equal(results[2].ok, true);
});
