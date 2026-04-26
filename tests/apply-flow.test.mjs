// tests/apply-flow.test.mjs
// Apply-flow backend coverage: appendApplicationMarkdown helper, dedupe, URL
// validation, pipeline seeding, status validation, multi-line notes round-trip.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import {
  appendApplicationMarkdown,
  appendProcessedPipelineItemMarkdown,
  parseApplicationsMarkdown,
  parsePipelineMarkdown,
  updateApplicationNotesMarkdown,
  createCareerOpsServer,
} from '../web-server.mjs';

// ── Pure helper tests ──────────────────────────────────────────────────

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

test('appendApplicationMarkdown — empty markdown scaffolds a fresh table', () => {
  const { markdown, number } = appendApplicationMarkdown('', {
    company: 'Careem',
    role: 'Senior Backend Engineer',
    status: 'Evaluated',
    score: 4.2,
    pdf: false,
  });
  assert.equal(number, 1);
  const parsed = parseApplicationsMarkdown(markdown);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].number, 1);
  assert.equal(parsed[0].company, 'Careem');
  assert.equal(parsed[0].role, 'Senior Backend Engineer');
  assert.equal(parsed[0].status, 'Evaluated');
  assert.equal(parsed[0].score, 4.2);
  assert.equal(parsed[0].pdf, false);
});

test('appendApplicationMarkdown — appends after existing rows + bumps the number', () => {
  const seed = HEADER
    + '| 1 | 2026-01-01 | Acme | Engineer | 3.5/5 | Applied | ✅ | — | first |\n'
    + '| 2 | 2026-01-02 | Other | PM       | 0.0/5 | Evaluated | ❌ | — |  |\n';
  const { markdown, number } = appendApplicationMarkdown(seed, {
    company: 'Tamara',
    role: 'Application Support Engineer',
    status: 'Applied',
    score: 4.8,
    pdf: true,
  });
  assert.equal(number, 3);
  const parsed = parseApplicationsMarkdown(markdown);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[2].number, 3);
  assert.equal(parsed[2].company, 'Tamara');
  assert.equal(parsed[2].pdf, true);
  // Existing rows must remain untouched.
  assert.equal(parsed[0].company, 'Acme');
  assert.equal(parsed[1].company, 'Other');
});

test('appendApplicationMarkdown — encodes pipe and newline so notes survive the table', () => {
  const { markdown } = appendApplicationMarkdown('', {
    company: 'Acme',
    role: 'Engineer',
    notes: 'first line | with pipe\nsecond line\nthird',
  });
  const parsed = parseApplicationsMarkdown(markdown);
  // Pipes are replaced with `/`, newlines escaped to `\n` literals.
  assert.match(parsed[0].notes, /first line \/ with pipe\\nsecond line\\nthird/);
});

test('appendApplicationMarkdown — rejects missing company/role', () => {
  assert.throws(() => appendApplicationMarkdown('', { role: 'Engineer' }), /company and role/);
  assert.throws(() => appendApplicationMarkdown('', { company: 'X' }), /company and role/);
});

test('appendApplicationMarkdown — rejects unsupported status', () => {
  assert.throws(
    () => appendApplicationMarkdown('', { company: 'X', role: 'Y', status: 'Bogus' }),
    /Unsupported status/,
  );
});

test('appendApplicationMarkdown — clamps score into 0..5 range', () => {
  const { markdown: high } = appendApplicationMarkdown('', { company: 'X', role: 'Y', score: 99 });
  assert.equal(parseApplicationsMarkdown(high)[0].score, 5.0);
  const { markdown: low } = appendApplicationMarkdown('', { company: 'X', role: 'Y', score: -3 });
  assert.equal(parseApplicationsMarkdown(low)[0].score, 0);
});

test('appendApplicationMarkdown — encodes report path as a markdown link', () => {
  const { markdown } = appendApplicationMarkdown('', {
    company: 'X', role: 'Y',
    reportPath: 'reports/042-x-2026-04-26.md',
  });
  const row = parseApplicationsMarkdown(markdown)[0];
  assert.equal(row.reportPath, 'reports/042-x-2026-04-26.md');
  assert.equal(row.reportLabel, '042-x-2026-04-26');
});

test('updateApplicationNotesMarkdown — encodes newlines so multi-line notes survive', () => {
  let { markdown } = appendApplicationMarkdown('', { company: 'X', role: 'Y' });
  markdown = updateApplicationNotesMarkdown(markdown, 1, 'Applied 2026-04-26\n- Q1 answer\n- Q2 answer');
  const row = parseApplicationsMarkdown(markdown)[0];
  assert.match(row.notes, /Applied 2026-04-26\\n- Q1 answer\\n- Q2 answer/);
});

test('appendProcessedPipelineItemMarkdown — adds a checked row under Procesadas', () => {
  const seed = '# pipeline\n\n## Pendientes\n\n## Procesadas\n\n';
  const next = appendProcessedPipelineItemMarkdown(seed, {
    url: 'https://example.com/job/1',
    company: 'Acme',
    role: 'Engineer',
  });
  const items = parsePipelineMarkdown(next);
  assert.equal(items.length, 1);
  assert.equal(items[0].checked, true);
  assert.equal(items[0].url, 'https://example.com/job/1');
});

test('appendProcessedPipelineItemMarkdown — creates Procesadas section when missing', () => {
  const seed = '# pipeline\n\n## Pendientes\n\n- [ ] https://other/job\n';
  const next = appendProcessedPipelineItemMarkdown(seed, {
    url: 'https://example.com/job/1',
    company: 'Acme',
    role: 'Engineer',
  });
  assert.match(next, /## Procesadas\n+- \[x\] https:\/\/example\.com\/job\/1/);
});

// ── HTTP integration tests ─────────────────────────────────────────────

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-apply-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf8');
  writeFileSync(join(dir, 'portals.yml'), 'sources: {}\n', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n## Procesadas\n\n', 'utf8');
  writeFileSync(join(dir, 'data', 'applications.md'), HEADER, 'utf8');
  return dir;
}

async function startServer(root) {
  const server = createCareerOpsServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(r)) };
}

test('POST /api/applications — happy path creates a row + seeds pipeline', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: 'Careem',
        role: 'Senior Backend Engineer',
        status: 'Applied',
        score: 4.5,
        url: 'https://job-boards.greenhouse.io/careem/jobs/1234',
        notes: 'Submitted via the dashboard.\nCV: cv-careem.pdf',
        pdf: true,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.number, 1);
    assert.equal(body.overview.metrics.totalApplications, 1);
    assert.equal(body.overview.applications[0].company, 'Careem');
    assert.equal(body.overview.applications[0].status, 'Applied');
    assert.equal(body.overview.applications[0].pdf, true);

    // Pipeline should have a processed row pointing at the URL.
    const pipelineText = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipelineText, /## Procesadas/);
    assert.match(pipelineText, /https:\/\/job-boards\.greenhouse\.io\/careem\/jobs\/1234/);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/applications — duplicate (company, role) returns 409 with existing number', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const make = (extras = {}) => fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'Tamara', role: 'AI Engineer', ...extras }),
    });
    const first = await make();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.number, 1);

    const second = await make();
    assert.equal(second.status, 409);
    const secondBody = await second.json();
    // The error field is JSON-stringified — clients parse it for the existing row.
    const detail = JSON.parse(secondBody.error);
    assert.equal(detail.error, 'duplicate');
    assert.equal(detail.existing.number, 1);

    // allow_duplicate bypasses the check.
    const force = await make({ allow_duplicate: true });
    assert.equal(force.status, 200);
    const forceBody = await force.json();
    assert.equal(forceBody.number, 2);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/applications — validates required fields, status enum, URL format', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const post = (body) => fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    let res = await post({ role: 'X' });
    assert.equal(res.status, 400);
    res = await post({ company: 'X' });
    assert.equal(res.status, 400);
    res = await post({ company: 'X', role: 'Y', status: 'Bogus' });
    assert.equal(res.status, 400);
    res = await post({ company: 'X', role: 'Y', score: 99 });
    assert.equal(res.status, 400);
    res = await post({ company: 'X', role: 'Y', url: 'javascript:bad' });
    assert.equal(res.status, 400);
    res = await post({ company: 'X', role: 'Y', notes: 'a'.repeat(5000) });
    assert.equal(res.status, 400);

    // After all those failures the file should still be empty (header only).
    const text = readFileSync(join(dir, 'data', 'applications.md'), 'utf8');
    assert.ok(!/\| 1 \|/.test(text), 'no row was written');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/applications — second URL with same row does not double-add to pipeline', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: 'Stripe', role: 'SWE',
        url: 'https://stripe.com/jobs/123',
      }),
    });
    await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: 'Stripe', role: 'PM',                // different role — no dedupe trigger
        url: 'https://stripe.com/jobs/123',           // same URL — should NOT be re-added
      }),
    });
    const pipelineText = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    const occurrences = (pipelineText.match(/https:\/\/stripe\.com\/jobs\/123/g) || []).length;
    assert.equal(occurrences, 1, 'URL appears exactly once in pipeline.md');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/applications — happy path with status flow Evaluated → Applied → Interview', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    // Step 1: create at Evaluated.
    let res = await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'Vercel', role: 'SWE', status: 'Evaluated' }),
    });
    const body1 = await res.json();
    assert.equal(body1.overview.applications[0].status, 'Evaluated');

    // Step 2: status → Applied via /api/status.
    res = await fetch(`${base}/api/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: body1.number, status: 'Applied' }),
    });
    const body2 = await res.json();
    assert.equal(body2.overview.applications[0].status, 'Applied');

    // Step 3: status → Interview.
    res = await fetch(`${base}/api/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: body1.number, status: 'Interview' }),
    });
    const body3 = await res.json();
    assert.equal(body3.overview.applications[0].status, 'Interview');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
