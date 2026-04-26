// tests/evaluate-endpoint.test.mjs
//
// End-to-end test for the SSE-driven /api/evaluate endpoint and its
// siblings (/api/draft-application, /api/deep-research, /api/contacto). We
// inject a mock provider into the registry so tests don't hit the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createCareerOpsServer } from '../web-server.mjs';

// ── Test workspace fixture ─────────────────────────────────────────────

function makeWorkspace(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-end-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# CV\n\n## Experience\nSWE for 10 years.\n', 'utf8');
  writeFileSync(join(dir, 'modes', '_shared.md'), '## Shared rules — be concise.', 'utf8');
  writeFileSync(join(dir, 'modes', '_profile.md'), '## Profile — target backend roles.', 'utf8');
  writeFileSync(join(dir, 'modes', 'oferta.md'), '## Mode oferta — output A–G with SCORE_SUMMARY.', 'utf8');
  writeFileSync(join(dir, 'modes', 'apply.md'), '## Mode apply — draft answers.', 'utf8');
  writeFileSync(join(dir, 'modes', 'deep.md'), '## Mode deep — research.', 'utf8');
  writeFileSync(join(dir, 'modes', 'contacto.md'), '## Mode contacto — outreach.', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n## Procesadas\n\n', 'utf8');
  writeFileSync(
    join(dir, 'data', 'applications.md'),
    '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n',
    'utf8',
  );
  writeFileSync(join(dir, 'portals.yml'), 'sources: {}\n', 'utf8');
  for (const [path, content] of Object.entries(overrides)) {
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
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Patch the gemini provider in-place so we don't hit the network. */
async function withMockedGemini(fn) {
  const mod = await import('../scanners/agents/gemini.mjs');
  const real = { available: mod.gemini.available, run: mod.gemini.run };
  mod.gemini.available = async () => ({ available: true });
  mod.gemini.run = async ({ onToken }) => {
    // Stream three chunks then a SCORE_SUMMARY footer so saveReport runs.
    const chunks = [
      '## Block A — Role summary\n\n',
      'A senior backend engineer at TestCo.\n\n',
      '---SCORE_SUMMARY---\nCOMPANY: TestCo\nROLE: SWE\nSCORE: 4.2\nARCHETYPE: FDE\nLEGITIMACY: High Confidence\n---END_SUMMARY---\n',
    ];
    let i = 0;
    let combined = '';
    for (const c of chunks) {
      combined += c;
      onToken?.({ chunk: c, tokenIndex: i++ });
    }
    return { text: combined, model: 'mock-gemini', family: 'gemini', durationMs: 5 };
  };
  try { return await fn(); } finally {
    mod.gemini.available = real.available;
    mod.gemini.run = real.run;
  }
}

/** Read all SSE events out of a Response body. */
async function consumeSSE(res) {
  const events = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      let event = '';
      let data = '';
      for (const line of record.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
      }
      if (event && data) {
        try { events.push({ event, data: JSON.parse(data) }); } catch { events.push({ event, data }); }
      }
    }
  }
  return events;
}

// ── Tests ──────────────────────────────────────────────────────────────

test('POST /api/evaluate — happy path streams tokens, parses summary, saves report', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    await withMockedGemini(async () => {
      const res = await fetch(`${base}/api/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jd_text: 'We are hiring a senior backend engineer at TestCo. The role pays well and is remote.',
          jd_url: 'https://test.co/jobs/1',
          model_id: 'gemini',
        }),
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

      const events = await consumeSSE(res);
      const tokenEvents = events.filter((e) => e.event === 'token');
      const doneEvents = events.filter((e) => e.event === 'done');
      assert.ok(tokenEvents.length >= 3, 'received at least 3 token events');
      assert.equal(doneEvents.length, 1, 'received exactly one done event');

      const done = doneEvents[0].data;
      assert.equal(done.summary.company, 'TestCo');
      assert.equal(done.summary.score, 4.2);
      assert.equal(done.summary.legitimacy, 'High Confidence');
      assert.ok(done.report_path?.startsWith('reports/'), 'report path is relative + under reports/');
      assert.equal(done.provider, 'gemini');

      // Report file actually exists with the parsed header.
      const reports = readdirSync(join(dir, 'reports'));
      assert.equal(reports.length, 1);
      assert.match(reports[0], /^001-testco-\d{4}-\d{2}-\d{2}\.md$/);
    });
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/evaluate — rejects too-short JD with actionable hint', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'short',                                  // < 40 chars
        model_id: 'gemini',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too short/i);
    assert.match(body.hint, /Paste/i);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/evaluate — unknown model_id returns 400, no SSE stream', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'A reasonably long JD that easily clears the 40-character minimum length floor.',
        model_id: 'bogus-provider',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Unknown provider/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/evaluate — unavailable provider returns 503 with hint', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  // Force gemini to be unavailable so we hit the 503 path.
  const mod = await import('../scanners/agents/gemini.mjs');
  const realAvailable = mod.gemini.available;
  mod.gemini.available = async () => ({ available: false, reason: 'GEMINI_API_KEY missing in test', hint: 'export GEMINI_API_KEY' });
  try {
    const res = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'A reasonably long JD that easily clears the 40-character minimum length floor.',
        model_id: 'gemini',
      }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /missing/);
    assert.match(body.hint, /GEMINI_API_KEY/);
  } finally {
    mod.gemini.available = realAvailable;
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/evaluate — language fallback picks modes/{lang}/{mode}.md when present', async () => {
  const dir = makeWorkspace({
    'modes/de/oferta.md': '## German oferta — antworten Sie auf Deutsch.',
  });
  const { base, close } = await startServer(dir);
  try {
    let capturedSystem;
    const mod = await import('../scanners/agents/gemini.mjs');
    const realAvailable = mod.gemini.available;
    const realRun = mod.gemini.run;
    mod.gemini.available = async () => ({ available: true });
    mod.gemini.run = async ({ system, onToken }) => {
      capturedSystem = system;
      onToken?.({ chunk: 'OK', tokenIndex: 0 });
      return { text: 'OK', model: 'mock', family: 'gemini', durationMs: 1 };
    };
    try {
      const res = await fetch(`${base}/api/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jd_text: 'A reasonably long JD that easily clears the 40-character floor and is German-flavored.',
          model_id: 'gemini',
          language: 'de',
        }),
      });
      assert.equal(res.status, 200);
      await consumeSSE(res);
      assert.match(capturedSystem, /German oferta — antworten Sie auf Deutsch/);
    } finally {
      mod.gemini.available = realAvailable;
      mod.gemini.run = realRun;
    }
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/draft-application — applies safeJoin to report_path (no path traversal)', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    let capturedUser;
    const mod = await import('../scanners/agents/gemini.mjs');
    const realAvailable = mod.gemini.available;
    const realRun = mod.gemini.run;
    mod.gemini.available = async () => ({ available: true });
    mod.gemini.run = async ({ user, onToken }) => {
      capturedUser = user;
      onToken?.({ chunk: 'drafted', tokenIndex: 0 });
      return { text: 'drafted', model: 'mock', family: 'gemini', durationMs: 1 };
    };
    try {
      // Try to escape via ../../etc/passwd — safeJoin must reject this.
      const res = await fetch(`${base}/api/draft-application`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jd_text: 'A reasonable JD that clears the 40-char floor with room to spare here.',
          report_path: '../../etc/passwd',
          model_id: 'gemini',
        }),
      });
      assert.equal(res.status, 200);
      await consumeSSE(res);
      // No "PRIOR EVALUATION REPORT" section because the path was rejected.
      assert.ok(!/PRIOR EVALUATION REPORT/.test(capturedUser));
    } finally {
      mod.gemini.available = realAvailable;
      mod.gemini.run = realRun;
    }
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
