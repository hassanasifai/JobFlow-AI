// tests/phase-h.test.mjs
// Phase H — UI-facing endpoints + remote_scope regression.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { classifyRemoteScope, normalizeJob } from '../scanners/_normalize.mjs';
import { createCareerOpsServer } from '../web-server.mjs';

// ── helpers ─────────────────────────────────────────────────────────────

function makeWorkspace(jobs = [], extraFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-h-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  if (jobs.length) {
    const jsonl = jobs.map((j) => JSON.stringify(j)).join('\n') + '\n';
    writeFileSync(join(dir, 'data', 'jobs.jsonl'), jsonl, 'utf8');
  }
  // Minimum scaffolding the overview endpoint expects so the server boots.
  writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf8');
  writeFileSync(join(dir, 'portals.yml'), 'sources: {}\n', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n', 'utf8');
  writeFileSync(
    join(dir, 'data', 'applications.md'),
    '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n',
    'utf8',
  );
  for (const [path, content] of Object.entries(extraFiles)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

async function startServer(root) {
  const server = createCareerOpsServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

// ── 1. /api/jobs ────────────────────────────────────────────────────────

test('GET /api/jobs returns empty list when jobs.jsonl missing', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/jobs`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 0);
    assert.deepEqual(body.items, []);
    assert.equal(body.limit, 50);
    assert.equal(body.offset, 0);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/jobs paginates and filters by region/source/q/since/remote', async () => {
  const now = Date.now();
  const j = (overrides) => ({
    title: 'Engineer', company: 'Acme', url: 'https://x/' + Math.random(),
    source: 'remoteok', region_group: 'remote_worldwide', remote: true,
    posted_at: new Date(now - 1 * 86_400_000).toISOString(),
    _scanned_at: new Date(now - 1 * 86_400_000).toISOString(),
    ...overrides,
  });
  const jobs = [
    j({ company: 'Careem', source: 'greenhouse', region_group: 'pakistan', url: 'https://x/pk-1' }),
    j({ company: 'Careem', source: 'greenhouse', region_group: 'gcc', url: 'https://x/uae-1' }),
    j({ company: 'Tamara', source: 'greenhouse', region_group: 'gcc', url: 'https://x/ksa-1' }),
    j({ company: 'Acme',   source: 'remoteok',   region_group: 'remote_worldwide', url: 'https://x/r-1' }),
    j({ company: 'OldCo',  source: 'lever',      region_group: 'usa', url: 'https://x/old',
        posted_at: new Date(now - 60 * 86_400_000).toISOString(),
        _scanned_at: new Date(now - 60 * 86_400_000).toISOString() }),
    j({ company: 'OnsiteCo', source: 'lever', region_group: 'uk', remote: false, url: 'https://x/uk-1' }),
  ];
  const dir = makeWorkspace(jobs);
  const { base, close } = await startServer(dir);
  try {
    const all = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(all.total, 6);

    const pkOnly = await (await fetch(`${base}/api/jobs?region=pakistan`)).json();
    assert.equal(pkOnly.total, 1);
    assert.equal(pkOnly.items[0].company, 'Careem');

    const gcc = await (await fetch(`${base}/api/jobs?region=gcc`)).json();
    assert.equal(gcc.total, 2);

    const gh = await (await fetch(`${base}/api/jobs?source=greenhouse`)).json();
    assert.equal(gh.total, 3);

    const recent = await (await fetch(`${base}/api/jobs?since=7`)).json();
    assert.equal(recent.total, 5);                                    // OldCo (60d) drops out

    const tamara = await (await fetch(`${base}/api/jobs?q=tamara`)).json();
    assert.equal(tamara.total, 1);
    assert.equal(tamara.items[0].company, 'Tamara');

    const remoteTrue = await (await fetch(`${base}/api/jobs?remote=true`)).json();
    assert.equal(remoteTrue.total, 5);

    const remoteFalse = await (await fetch(`${base}/api/jobs?remote=false`)).json();
    assert.equal(remoteFalse.total, 1);
    assert.equal(remoteFalse.items[0].company, 'OnsiteCo');

    const page = await (await fetch(`${base}/api/jobs?limit=2&offset=2`)).json();
    assert.equal(page.items.length, 2);
    assert.equal(page.offset, 2);
    assert.equal(page.limit, 2);
    assert.equal(page.total, 6);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. /api/sources/health ──────────────────────────────────────────────

test('GET /api/sources/health rolls up per-provider stats from jobs.jsonl', async () => {
  const now = Date.now();
  const jobs = [
    { source: 'remoteok', title: 't', url: 'u1', _scanned_at: new Date(now - 1 * 86_400_000).toISOString() },
    { source: 'remoteok', title: 't', url: 'u2', _scanned_at: new Date(now - 1 * 86_400_000).toISOString() },
    { source: 'greenhouse', title: 't', url: 'u3', _scanned_at: new Date(now - 30 * 86_400_000).toISOString() },
  ];
  const dir = makeWorkspace(jobs);
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/sources/health`);
    assert.equal(res.status, 200);
    const list = await res.json();
    const remoteok = list.find((s) => s.id === 'remoteok');
    const greenhouse = list.find((s) => s.id === 'greenhouse');
    assert.ok(remoteok, 'remoteok present');
    assert.equal(remoteok.total, 2);
    assert.equal(remoteok.jobs_7d, 2);
    assert.equal(remoteok.status, 'healthy');
    assert.ok(greenhouse, 'greenhouse present');
    assert.equal(greenhouse.total, 1);
    assert.equal(greenhouse.jobs_7d, 0);                                 // 30d ago
    assert.equal(greenhouse.status, 'stale');
    // Adapters with zero jobs in jsonl but no env keys missing should still
    // appear (status: unknown / unavailable / needs_config).
    assert.ok(list.length >= 5, 'every adapter listed');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. /api/saved-searches ──────────────────────────────────────────────

test('saved searches: GET empty, POST upserts, GET returns, DELETE removes', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const list1 = await (await fetch(`${base}/api/saved-searches`)).json();
    assert.deepEqual(list1.items, []);

    const create = await fetch(`${base}/api/saved-searches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'pk-engineering',
        name: 'PK Engineering',
        region: ['pakistan'],
        titles: ['engineer', 'developer'],
        sources: ['greenhouse', 'mustakbil'],
        since_days: 7,
      }),
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.id, 'pk-engineering');
    assert.deepEqual(created.region, ['pakistan']);
    assert.equal(created.since_days, 7);
    assert.ok(created.created_at, 'created_at populated');
    assert.ok(created.updated_at, 'updated_at populated');

    const list2 = await (await fetch(`${base}/api/saved-searches`)).json();
    assert.equal(list2.items.length, 1);
    assert.equal(list2.items[0].name, 'PK Engineering');

    // Re-POST same id — updates in place, preserves created_at.
    const originalCreated = list2.items[0].created_at;
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${base}/api/saved-searches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pk-engineering', name: 'PK Eng v2', region: ['pakistan'] }),
    });
    const list3 = await (await fetch(`${base}/api/saved-searches`)).json();
    assert.equal(list3.items.length, 1);
    assert.equal(list3.items[0].name, 'PK Eng v2');
    assert.equal(list3.items[0].created_at, originalCreated);

    // Bad id rejected.
    const bad = await fetch(`${base}/api/saved-searches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'NOT a slug!', name: 'x' }),
    });
    assert.equal(bad.status, 400);

    // Delete.
    const del = await fetch(`${base}/api/saved-searches/pk-engineering`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const list4 = await (await fetch(`${base}/api/saved-searches`)).json();
    assert.equal(list4.items.length, 0);

    // Delete unknown id → 404.
    const del404 = await fetch(`${base}/api/saved-searches/nope`, { method: 'DELETE' });
    assert.equal(del404.status, 404);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. remote_scope regression: description text must NOT contaminate ───

test('classifyRemoteScope: description with "worldwide" does not override Riyadh location', () => {
  // Real-world case: Tamara KSA jobs whose JD copy mentions "serving the GCC
  // and worldwide". Before the fix this returned 'worldwide'.
  const scope = classifyRemoteScope({
    location: 'Riyadh, Saudi Arabia',
    remote: false,
    description: 'Tamara is on a mission to reshape financial services across the GCC and worldwide.',
  });
  assert.equal(scope, 'none');                                // not remote at all
});

test('classifyRemoteScope: country-anchored remote stays "country" when description says worldwide', () => {
  const scope = classifyRemoteScope({
    location: 'Lahore, Pakistan',
    remote: true,
    description: 'Join our worldwide engineering team.',
  });
  assert.equal(scope, 'country');                             // location wins
});

test('classifyRemoteScope: empty location with remote=true stays worldwide', () => {
  assert.equal(classifyRemoteScope({ location: '', remote: true }), 'worldwide');
  assert.equal(classifyRemoteScope({ location: 'Anywhere', remote: true }), 'worldwide');
});

test('classifyRemoteScope: EMEA in location is region, even if description has worldwide', () => {
  const scope = classifyRemoteScope({
    location: 'Remote EMEA',
    remote: true,
    description: 'we have offices worldwide',
  });
  assert.equal(scope, 'region');
});

test('normalizeJob applies the tightened scope on Tamara/Riyadh case end-to-end', () => {
  const j = normalizeJob({
    title: 'Application Support Engineer',
    company: 'Tamara',
    location: 'Riyadh, Saudi Arabia',
    description: 'Tamara serves customers across the GCC and worldwide.',
    url: 'https://example.com/tamara/123',
    source: 'greenhouse',
    source_id: 'tamara-123',
    remote: false,
  });
  assert.equal(j.region_group, 'gcc');
  assert.equal(j.country_code, 'SA');
  assert.equal(j.remote_scope, 'none');                       // <- the bug fix
});
