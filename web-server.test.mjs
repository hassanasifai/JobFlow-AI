import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import {
  computeOverview,
  parseApplicationsMarkdown,
  parsePipelineMarkdown,
  updateApplicationStatusMarkdown,
} from './web-server.mjs';

test('parseApplicationsMarkdown returns normalized application rows', () => {
  const markdown = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-24 | Acme AI | Forward Deployed Engineer | 4.4/5 | applied | ✅ | [001](reports/001-acme.md) | Strong fit |
`;

  assert.deepEqual(parseApplicationsMarkdown(markdown), [
    {
      number: 1,
      date: '2026-04-24',
      company: 'Acme AI',
      role: 'Forward Deployed Engineer',
      score: 4.4,
      scoreRaw: '4.4/5',
      status: 'applied',
      pdf: true,
      reportPath: 'reports/001-acme.md',
      reportLabel: '001',
      notes: 'Strong fit',
    },
  ]);
});

test('parsePipelineMarkdown reads pending job URLs for nontechnical inbox cards', () => {
  const markdown = `# career-ops pipeline

## Pendientes

- [ ] https://jobs.example.com/1 | Acme AI | AI Engineer
- [x] https://jobs.example.com/2 | Done Co | Product Manager
- [ ] https://jobs.example.com/3 | Plain Role
`;

  assert.deepEqual(parsePipelineMarkdown(markdown), [
    {
      lineNumber: 5,
      checked: false,
      url: 'https://jobs.example.com/1',
      company: 'Acme AI',
      role: 'AI Engineer',
    },
    {
      lineNumber: 6,
      checked: true,
      url: 'https://jobs.example.com/2',
      company: 'Done Co',
      role: 'Product Manager',
    },
    {
      lineNumber: 7,
      checked: false,
      url: 'https://jobs.example.com/3',
      company: 'Unknown company',
      role: 'Plain Role',
    },
  ]);
});

test('computeOverview summarizes setup, statuses, and pipeline counts', async () => {
  const root = join(tmpdir(), `career-ops-web-${Date.now()}`);
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'cv.md'), '# CV\n');
  await writeFile(join(root, 'config', 'profile.yml'), 'name: Test\n');
  await writeFile(join(root, 'portals.yml'), 'companies: []\n');
  await writeFile(join(root, 'data', 'applications.md'), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-24 | Acme | AI Engineer | 4.5/5 | interview | ✅ | - | Active |
`);
  await writeFile(join(root, 'data', 'pipeline.md'), '- [ ] https://jobs.example.com/1 | Acme | AI Engineer\n');

  const overview = await computeOverview(root);

  assert.equal(overview.setup.ready, true);
  assert.equal(overview.metrics.totalApplications, 1);
  assert.equal(overview.metrics.pendingPipeline, 1);
  assert.equal(overview.metrics.byStatus.interview, 1);
});

test('updateApplicationStatusMarkdown changes only the matched row status', async () => {
  const markdown = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-24 | Acme | AI Engineer | 4.5/5 | evaluated | ✅ | [001](reports/001-acme.md) | Active |
| 2 | 2026-04-25 | Beta | PM | 3.5/5 | applied | ❌ | - | Later |
`;

  const updated = updateApplicationStatusMarkdown(markdown, 1, 'Interview');
  const rows = parseApplicationsMarkdown(updated);

  assert.equal(rows[0].status, 'Interview');
  assert.equal(rows[1].status, 'applied');
  assert.match(updated, /\| 1 \| 2026-04-24 \| Acme \| AI Engineer \| 4.5\/5 \| Interview \|/);
});

test('web assets include a main landmark and accessible command buttons', async () => {
  const html = await readFile(new URL('./web/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('./web/app.js', import.meta.url), 'utf8');

  assert.match(html, /<main/);
  assert.match(html, /aria-live="polite"/);
  assert.match(js, /Run health check/);
  assert.match(js, /aria-label/);
});
