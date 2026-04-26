// tests/scan-fixes.test.mjs
//
// Coverage for the four user-reported scan-flow bugs:
//   1. Env-var `${VAR}` interpolation in source configs
//   2. requiresInputs surfaces "no-inputs" skip instead of silent zero-run
//   3. since_days filter drops stale jobs
//   4. Sources health endpoint returns the new `needs_inputs` status

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { interpolateEnvVars, runAdapters } from '../scanners/_registry.mjs';
import { createCareerOpsServer } from '../web-server.mjs';

// ── Pure helper ────────────────────────────────────────────────────────

test('interpolateEnvVars — replaces ${VAR} with process.env.VAR', () => {
  const before = process.env.TEST_INTERP;
  process.env.TEST_INTERP = 'real-key-123';
  try {
    assert.equal(interpolateEnvVars('${TEST_INTERP}'), 'real-key-123');
    assert.equal(interpolateEnvVars('prefix-${TEST_INTERP}-suffix'), 'prefix-real-key-123-suffix');
    assert.deepEqual(
      interpolateEnvVars({ api_key: '${TEST_INTERP}', other: 'plain' }),
      { api_key: 'real-key-123', other: 'plain' },
    );
    assert.deepEqual(
      interpolateEnvVars(['${TEST_INTERP}', { nested: '${TEST_INTERP}' }]),
      ['real-key-123', { nested: 'real-key-123' }],
    );
  } finally {
    if (before == null) delete process.env.TEST_INTERP;
    else process.env.TEST_INTERP = before;
  }
});

test('interpolateEnvVars — empty env resolves to empty string (not literal placeholder)', () => {
  const before = process.env.NEVER_SET_BY_TESTS;
  delete process.env.NEVER_SET_BY_TESTS;
  try {
    // The bug we're fixing: `${THE_MUSE_KEY}` would otherwise reach the URL
    // verbatim and outshine the adapter's process.env fallback.
    assert.equal(interpolateEnvVars('${NEVER_SET_BY_TESTS}'), '');
    assert.equal(interpolateEnvVars('plain text'), 'plain text');
    assert.equal(interpolateEnvVars(123), 123);
    assert.equal(interpolateEnvVars(null), null);
  } finally {
    if (before != null) process.env.NEVER_SET_BY_TESTS = before;
  }
});

// ── runAdapters integration ────────────────────────────────────────────

const FAKE_ADAPTER = (id, fetchFn, meta = {}) => ({
  id,
  kind: 'api',
  meta: { id, kind: 'api', ...meta },
  missingEnv: [],
  fetch: fetchFn,
});

test('runAdapters — interpolates ${VAR} before passing config to the adapter', async () => {
  process.env.MOCK_ADAPTER_KEY = 'expanded-value';
  let captured;
  const adapter = FAKE_ADAPTER('mock', (cfg) => {
    captured = cfg;
    return [];
  });
  try {
    await runAdapters({
      config: {
        sources: { mock: { enabled: true, api_key: '${MOCK_ADAPTER_KEY}' } },
        title_filter: { positive: [] },
      },
      adapters: [adapter],
    });
    assert.equal(captured.api_key, 'expanded-value');
  } finally {
    delete process.env.MOCK_ADAPTER_KEY;
  }
});

test('runAdapters — requiresInputs without companies → "no-inputs" skip with detail', async () => {
  const adapter = FAKE_ADAPTER('greenhouse', () => {
    throw new Error('should not be called');
  }, { requiresInputs: ['companies'] });
  const result = await runAdapters({
    config: {
      sources: { greenhouse: { enabled: true } },                  // no companies
      title_filter: { positive: [] },
    },
    adapters: [adapter],
  });
  assert.equal(result.jobs.length, 0);
  const skipped = result.skipped.find((s) => s.id === 'greenhouse');
  assert.ok(skipped, 'expected a skipped entry');
  assert.equal(skipped.reason, 'no-inputs');
  assert.deepEqual(skipped.missing, ['companies']);
  assert.match(skipped.detail, /Configure companies/);
});

test('runAdapters — requiresInputs satisfied by config.companies → adapter runs', async () => {
  let called = false;
  const adapter = FAKE_ADAPTER('greenhouse', () => {
    called = true;
    return [{ title: 'Engineer', url: 'https://x/1', company: 'Acme' }];
  }, { requiresInputs: ['companies'] });
  const result = await runAdapters({
    config: {
      sources: { greenhouse: { enabled: true, companies: ['acme'] } },
      title_filter: { positive: [] },
    },
    adapters: [adapter],
  });
  assert.equal(called, true);
  assert.equal(result.jobs.length, 1);
});

test('runAdapters — requiresInputs satisfied by query.companies → adapter runs even without YAML', async () => {
  let received;
  const adapter = FAKE_ADAPTER('greenhouse', (cfg) => {
    received = cfg;
    return [];
  }, { requiresInputs: ['companies'] });
  await runAdapters({
    config: {
      sources: { greenhouse: { enabled: true } },                  // no companies in YAML
      title_filter: { positive: [] },
    },
    adapters: [adapter],
    query: { companies: ['runtime-acme'] },                          // CLI override
  });
  // The companies array gets merged into the per-adapter cfg as "companies"
  // (queryToAdapterFields).
  assert.deepEqual(received.companies, ['runtime-acme']);
});

test('runAdapters — sinceDays drops stale jobs while keeping undated ones', async () => {
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();    // 2 d ago
  const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();    // 30 d ago
  const adapter = FAKE_ADAPTER('mock', () => [
    { title: 'Recent role', url: 'https://x/1', company: 'A', posted_at: recent },
    { title: 'Stale role',  url: 'https://x/2', company: 'B', posted_at: stale },
    { title: 'Undated role', url: 'https://x/3', company: 'C' },         // no date — passes
  ]);
  const result = await runAdapters({
    config: {
      sources: { mock: { enabled: true } },
      title_filter: { positive: [] },
    },
    adapters: [adapter],
    query: { sinceDays: 7 },
  });
  const titles = result.jobs.map((j) => j.title).sort();
  assert.deepEqual(titles, ['Recent role', 'Undated role']);
});

test('runAdapters — sinceDays not set → all jobs pass', async () => {
  const stale = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const adapter = FAKE_ADAPTER('mock', () => [
    { title: 'Ancient', url: 'https://x/1', company: 'A', posted_at: stale },
  ]);
  const result = await runAdapters({
    config: {
      sources: { mock: { enabled: true } },
      title_filter: { positive: [] },
    },
    adapters: [adapter],
  });
  assert.equal(result.jobs.length, 1);
});

// ── HTTP integration ───────────────────────────────────────────────────

function makeWorkspace(extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-fixes-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n', 'utf8');
  writeFileSync(
    join(dir, 'data', 'applications.md'),
    '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n',
    'utf8',
  );
  writeFileSync(join(dir, 'portals.yml'), extras.portals || 'sources: {}\n', 'utf8');
  return dir;
}

async function startServer(root) {
  const server = createCareerOpsServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('GET /api/sources/health — surfaces "needs_inputs" for ATS adapters with no companies', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/sources/health`);
    assert.equal(res.status, 200);
    const list = await res.json();
    const greenhouse = list.find((s) => s.id === 'greenhouse');
    assert.ok(greenhouse, 'greenhouse must be in the list');
    assert.equal(greenhouse.status, 'needs_inputs');
    assert.deepEqual(greenhouse.missingInputs, ['companies']);

    const universal = list.find((s) => s.id === 'universal');
    if (universal) {                                                 // adapter ships with the project
      assert.equal(universal.status, 'needs_inputs');
      assert.deepEqual(universal.missingInputs, ['urls']);
    }
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sources/health — healthy when companies supplied', async () => {
  const dir = makeWorkspace({
    portals: 'sources:\n  greenhouse:\n    enabled: true\n    companies: ["acme", "stripe"]\n',
  });
  const { base, close } = await startServer(dir);
  try {
    const list = await (await fetch(`${base}/api/sources/health`)).json();
    const greenhouse = list.find((s) => s.id === 'greenhouse');
    // We don't have any jobs in jobs.jsonl yet → status is 'unknown', not
    // 'needs_inputs'. The adapter is configured correctly.
    assert.equal(greenhouse.status, 'unknown');
    assert.deepEqual(greenhouse.missingInputs, []);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/sources/health — web3career marked unavailable', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const list = await (await fetch(`${base}/api/sources/health`)).json();
    const w3 = list.find((s) => s.id === 'web3career');
    assert.ok(w3, 'web3career must still appear in the registry');
    assert.equal(w3.status, 'unavailable');
    assert.equal(w3.unavailable, true);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/scan/run — accepts since_days in query body', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/scan/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sources: ['gemini-fake-but-validates'],                        // unknown id → 400 below
        query: { since_days: 7, titles: ['engineer'] },
        dry_run: true,
      }),
    });
    // Expect a clean 400 with a clear message — proves the body validated
    // including since_days, and the unknown source rejection fired AFTER.
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Unknown source/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
