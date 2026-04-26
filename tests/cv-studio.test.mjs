// tests/cv-studio.test.mjs
//
// CV Studio — full pipeline coverage. Mocks the agent so we don't burn
// quota; the real assertion is that we (1) compose the system prompt with
// the template + cv + mode + profile, (2) accept the agent's HTML, (3) save
// it with the right filename, and (4) shell out to generate-pdf.mjs with
// the correct format flag.
//
// We DO actually shell out — the test workspace ships a stub
// `generate-pdf.mjs` that just writes a fake PDF placeholder. That keeps
// tests fast (no Playwright spin-up) while exercising the real execFile
// pathway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createCareerOpsServer } from '../web-server.mjs';

const MIN_TEMPLATE = `<!DOCTYPE html>
<html lang="{{LANG}}">
<head><title>{{NAME}} — CV</title></head>
<body>
  <h1>{{NAME}}</h1>
  <p>{{EMAIL}} · {{LOCATION}}</p>
  <section><h2>{{SECTION_SUMMARY}}</h2><p>{{SUMMARY_TEXT}}</p></section>
  <section><h2>{{SECTION_EXPERIENCE}}</h2>{{EXPERIENCE}}</section>
</body>
</html>`;

const STUB_GENERATE_PDF = `#!/usr/bin/env node
// Test stub — writes a 1KB placeholder so the pipeline can complete fast.
import { writeFileSync } from 'fs';
const [, , inputHtml, outputPdf] = process.argv;
if (!inputHtml || !outputPdf) { console.error('args missing'); process.exit(1); }
writeFileSync(outputPdf, '%PDF-1.4 stub ' + 'x'.repeat(800));
console.log('stub-pdf-ok input=' + inputHtml + ' output=' + outputPdf);
`;

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'cv-studio-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'templates'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# Jane Doe\n\n## Experience\n- SWE at Acme, 2018-2024\n', 'utf8');
  writeFileSync(join(dir, 'modes', '_shared.md'), '## Shared rules', 'utf8');
  writeFileSync(join(dir, 'modes', '_profile.md'), '## Profile — backend roles.', 'utf8');
  writeFileSync(join(dir, 'modes', 'pdf.md'), '## Mode pdf — render the template, fill placeholders.', 'utf8');
  writeFileSync(join(dir, 'templates', 'cv-template.html'), MIN_TEMPLATE, 'utf8');
  writeFileSync(join(dir, 'config', 'profile.yml'), 'name: "Jane Doe"\nemail: "jane@example.com"\nlocation: "Lahore, Pakistan"\n', 'utf8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# pipeline\n\n## Pendientes\n\n## Procesadas\n\n', 'utf8');
  writeFileSync(
    join(dir, 'data', 'applications.md'),
    '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n',
    'utf8',
  );
  writeFileSync(join(dir, 'portals.yml'), 'sources: {}\n', 'utf8');
  writeFileSync(join(dir, 'generate-pdf.mjs'), STUB_GENERATE_PDF, 'utf8');
  return dir;
}

async function startServer(root) {
  const server = createCareerOpsServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

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

test('POST /api/generate-cv — agent HTML → save → PDF stub → done event', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  // Mock gemini to return a valid filled-template HTML.
  const mod = await import('../scanners/agents/gemini.mjs');
  const realAvailable = mod.gemini.available;
  const realRun = mod.gemini.run;
  mod.gemini.available = async () => ({ available: true });
  mod.gemini.run = async ({ system, onToken }) => {
    // Smoke: confirm system prompt includes the template.
    assert.match(system, /<title>\{\{NAME\}\} — CV<\/title>/);
    assert.match(system, /Mode pdf — render the template/);
    assert.match(system, /SWE at Acme/);                   // cv.md content
    const filledHtml = MIN_TEMPLATE
      .replace(/\{\{LANG\}\}/g, 'en')
      .replace(/\{\{NAME\}\}/g, 'Jane Doe')
      .replace(/\{\{EMAIL\}\}/g, 'jane@example.com')
      .replace(/\{\{LOCATION\}\}/g, 'Lahore, Pakistan')
      .replace(/\{\{SECTION_SUMMARY\}\}/g, 'Summary')
      .replace(/\{\{SUMMARY_TEXT\}\}/g, 'Backend engineer with 6 years of experience.')
      .replace(/\{\{SECTION_EXPERIENCE\}\}/g, 'Experience')
      .replace(/\{\{EXPERIENCE\}\}/g, '<ul><li>SWE at Acme, 2018-2024</li></ul>');
    onToken?.({ chunk: filledHtml.slice(0, 200), tokenIndex: 0 });
    onToken?.({ chunk: filledHtml.slice(200), tokenIndex: 1 });
    return { text: filledHtml, model: 'mock-gemini', family: 'gemini', durationMs: 5 };
  };

  try {
    const res = await fetch(`${base}/api/generate-cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'Senior backend engineer at TestCo. Stack: Node, Postgres. 5+ years. Remote within Pakistan or GCC.',
        jd_url: 'https://test.co/jobs/1',
        company: 'TestCo',
        model_id: 'gemini',
        language: 'en',
        paper: 'a4',
      }),
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);

    const stages = events.filter((e) => e.event === 'stage').map((e) => e.data.stage);
    assert.deepEqual(stages, ['tailoring', 'rendering', 'pdf']);

    const doneEvents = events.filter((e) => e.event === 'done');
    assert.equal(doneEvents.length, 1);
    const done = doneEvents[0].data;
    assert.match(done.html_path, /^output\/cv-jane-doe-testco-\d{4}-\d{2}-\d{2}\.html$/);
    assert.match(done.pdf_path, /^output\/cv-jane-doe-testco-\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.equal(done.candidate, 'jane-doe');
    assert.equal(done.company, 'testco');
    assert.equal(done.paper, 'a4');
    assert.ok(done.size_bytes > 0);

    // The HTML file actually exists with the agent's output.
    const htmlPath = join(dir, done.html_path);
    assert.ok(existsSync(htmlPath));
    const writtenHtml = readFileSync(htmlPath, 'utf8');
    assert.match(writtenHtml, /Jane Doe/);
    assert.match(writtenHtml, /SWE at Acme/);

    // The stub PDF was written.
    const pdfPath = join(dir, done.pdf_path);
    assert.ok(existsSync(pdfPath));
    assert.match(readFileSync(pdfPath, 'utf8'), /^%PDF-1\.4 stub/);
  } finally {
    mod.gemini.available = realAvailable;
    mod.gemini.run = realRun;
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/generate-cv — strips ```html fences if the model wraps output', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  const mod = await import('../scanners/agents/gemini.mjs');
  const realAvailable = mod.gemini.available;
  const realRun = mod.gemini.run;
  mod.gemini.available = async () => ({ available: true });
  mod.gemini.run = async ({ onToken }) => {
    // Realistic failure mode: model wraps in markdown.
    const wrapped = '```html\n<!DOCTYPE html>\n<html lang="en"><head><title>Wrapped</title></head><body>x</body></html>\n```';
    onToken?.({ chunk: wrapped, tokenIndex: 0 });
    return { text: wrapped, model: 'mock', family: 'gemini', durationMs: 1 };
  };
  try {
    const res = await fetch(`${base}/api/generate-cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'A reasonably long JD that easily clears the 40-character minimum length floor for testing.',
        company: 'Wrapped',
        model_id: 'gemini',
        paper: 'letter',
      }),
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const done = events.find((e) => e.event === 'done')?.data;
    assert.ok(done, 'expected a done event');
    const writtenHtml = readFileSync(join(dir, done.html_path), 'utf8');
    assert.ok(!writtenHtml.startsWith('```'), 'fence stripped from saved HTML');
    assert.match(writtenHtml, /^<!DOCTYPE html>/);
  } finally {
    mod.gemini.available = realAvailable;
    mod.gemini.run = realRun;
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/generate-cv — surfaces unfilled placeholders as a warning', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  const mod = await import('../scanners/agents/gemini.mjs');
  const realAvailable = mod.gemini.available;
  const realRun = mod.gemini.run;
  mod.gemini.available = async () => ({ available: true });
  mod.gemini.run = async ({ onToken }) => {
    // Model leaves {{LOCATION}} unfilled.
    const partial = `<!DOCTYPE html>\n<html lang="en"><head><title>Jane Doe — CV</title></head><body><p>{{LOCATION}}</p></body></html>`;
    onToken?.({ chunk: partial, tokenIndex: 0 });
    return { text: partial, model: 'mock', family: 'gemini', durationMs: 1 };
  };
  try {
    const res = await fetch(`${base}/api/generate-cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'A reasonably long JD that easily clears the 40-character minimum length floor for testing.',
        company: 'Partial',
        model_id: 'gemini',
      }),
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const warnings = events.filter((e) => e.event === 'warning');
    assert.ok(warnings.some((w) => /LOCATION/.test(w.data.message)));
    // Still completes — warnings are advisory, not fatal.
    assert.ok(events.some((e) => e.event === 'done'));
  } finally {
    mod.gemini.available = realAvailable;
    mod.gemini.run = realRun;
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/generate-cv — short JD rejected, no agent call, no files', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  try {
    const res = await fetch(`${base}/api/generate-cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jd_text: 'too short', model_id: 'gemini' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too short/i);
    // No output directory created.
    assert.equal(existsSync(join(dir, 'output')), false);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/generate-cv — non-HTML output → error event with preview', async () => {
  const dir = makeWorkspace();
  const { base, close } = await startServer(dir);
  const mod = await import('../scanners/agents/gemini.mjs');
  const realAvailable = mod.gemini.available;
  const realRun = mod.gemini.run;
  mod.gemini.available = async () => ({ available: true });
  mod.gemini.run = async ({ onToken }) => {
    // Model returns plain markdown — no <html> tag.
    const txt = "I'm sorry, I can only respond in markdown:\n\n# Jane Doe\n## Experience\n- SWE";
    onToken?.({ chunk: txt, tokenIndex: 0 });
    return { text: txt, model: 'mock', family: 'gemini', durationMs: 1 };
  };
  try {
    const res = await fetch(`${base}/api/generate-cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jd_text: 'A reasonably long JD that easily clears the 40-character minimum length floor for testing.',
        model_id: 'gemini',
      }),
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const error = events.find((e) => e.event === 'error');
    assert.ok(error, 'expected an error event');
    assert.match(error.data.message, /HTML/);
    assert.ok(error.data.preview);
  } finally {
    mod.gemini.available = realAvailable;
    mod.gemini.run = realRun;
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
