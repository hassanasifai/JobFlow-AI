import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  classifyRemoteScope,
  jobMatchesRegions,
  normalizeLocation,
  normalizeRegionToken,
} from '../scanners/_normalize.mjs';
import {
  createJobFingerprint,
  isDuplicate,
  normalizeCompany,
  normalizeTitle,
  normalizeUrl,
} from '../scanners/_dedupe.mjs';
import { runGlobalScan } from '../scanners/_global_scan.mjs';
import { runAdapters } from '../scanners/_registry.mjs';
import fetchSmartRecruiters from '../scanners/ats/smartrecruiters.mjs';
import { fetchWithRetry } from '../scanners/_base.mjs';

test('normalizes Pakistan locations', () => {
  const karachi = normalizeLocation('Karachi, Pakistan');
  assert.equal(karachi.country_code, 'PK');
  assert.equal(karachi.region_group, 'pakistan');

  const remotePk = normalizeLocation('Remote Pakistan');
  assert.equal(remotePk.country_code, 'PK');
  assert.equal(remotePk.region_group, 'pakistan');
  assert.equal(classifyRemoteScope({ location: 'Remote Pakistan', remote: true }), 'country');
});

test('normalizes GCC, UAE, and Saudi locations', () => {
  assert.equal(normalizeLocation('Dubai, UAE').region_group, 'gcc');
  assert.equal(normalizeLocation('Abu Dhabi, United Arab Emirates').country_code, 'AE');
  assert.equal(normalizeLocation('Riyadh, KSA').country_code, 'SA');
  assert.equal(normalizeLocation('Doha, Qatar').region_group, 'gcc');
});

test('normalizes Ireland, Poland, USA, and UK locations', () => {
  assert.equal(normalizeLocation('Dublin, Ireland').region_group, 'ireland');
  assert.equal(normalizeLocation('Krakow, Poland').country_code, 'PL');
  assert.equal(normalizeLocation('United States').region_group, 'usa');
  assert.equal(normalizeLocation('London, UK').country_code, 'GB');
});

test('detects worldwide and regional remote scopes', () => {
  assert.equal(classifyRemoteScope({ location: 'Remote Worldwide', remote: true }), 'worldwide');
  assert.equal(classifyRemoteScope({ location: 'Anywhere', remote: true }), 'worldwide');
  assert.equal(classifyRemoteScope({ location: 'Remote EMEA', remote: true }), 'region');
  assert.equal(classifyRemoteScope({ location: 'Remote GCC', remote: true }), 'region');
  assert.equal(classifyRemoteScope({ location: 'Lahore, Pakistan', remote: false }), 'none');
});

test('region filtering excludes US-only roles for Pakistan/GCC/worldwide remote scans', () => {
  const usOnly = {
    title: 'Senior Backend Engineer',
    location: 'Remote - US only',
    remote: true,
    remote_scope: 'country',
    region_group: 'usa',
    country_code: 'US',
  };

  assert.equal(jobMatchesRegions(usOnly, ['pakistan', 'gcc', 'remote_worldwide']), false);
  assert.equal(jobMatchesRegions(usOnly, ['usa']), true);
});

test('normalizes region aliases used by the CLI', () => {
  assert.deepEqual(normalizeRegionToken('remote'), ['remote_worldwide', 'remote_region']);
  assert.deepEqual(normalizeRegionToken('worldwide'), ['remote_worldwide']);
  assert.deepEqual(normalizeRegionToken('saudi_arabia'), ['gcc']);
});

test('deduplicates same provider/source id and canonical URLs', () => {
  const existing = [
    { source: 'remoteok', source_id: '123', url: 'https://remoteok.com/remote-jobs/123?utm_source=x' },
    { source: 'greenhouse', source_id: 'gh-1', url: 'https://boards.greenhouse.io/acme/jobs/1' },
  ];

  assert.equal(isDuplicate({ source: 'remoteok', source_id: '123', url: 'https://example.com/job' }, existing), true);
  assert.equal(isDuplicate({ source: 'lever', source_id: 'x', url: 'https://remoteok.com/remote-jobs/123' }, existing), true);
  assert.equal(normalizeUrl('https://www.Example.com/jobs/1/?utm_campaign=x#apply'), 'https://example.com/jobs/1');
});

test('deduplicates fuzzy company/title/location within seven days', () => {
  const existing = [{
    company: 'Acme, Inc.',
    title: 'Senior Full-Stack Engineer',
    location: 'Remote Pakistan',
    date_posted: '2026-04-20',
  }];
  const job = {
    company: 'Acme Inc',
    title: 'Senior Full Stack Engineer',
    location: 'Pakistan Remote',
    date_posted: '2026-04-25',
  };

  assert.equal(normalizeCompany('Acme, Inc.'), 'acme');
  assert.equal(normalizeTitle('Senior Full-Stack Engineer'), 'senior full stack engineer');
  assert.equal(createJobFingerprint(job).includes('senior full stack engineer'), true);
  assert.equal(isDuplicate(job, existing), true);
});

test('provider failure does not crash adapter run', async () => {
  const adapters = [
    {
      id: 'good',
      kind: 'api',
      meta: { id: 'good', kind: 'api' },
      missingEnv: [],
      fetch: async () => [{ title: 'Software Engineer', company: 'Good', url: 'https://example.com/good', source: 'good' }],
    },
    {
      id: 'bad',
      kind: 'api',
      meta: { id: 'bad', kind: 'api' },
      missingEnv: [],
      fetch: async () => { throw new Error('boom'); },
    },
  ];

  const result = await runAdapters({
    config: {
      title_filter: { positive: ['engineer'] },
      sources: { good: { enabled: true }, bad: { enabled: true } },
    },
    adapters,
    concurrency: 2,
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'bad');
});

test('dry-run does not write to pipeline.md', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'career-ops-scan-'));
  try {
    mkdirSync(path.join(dir, 'data'), { recursive: true });
    writeFileSync(path.join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n\n', 'utf-8');

    await runGlobalScan({
      cwd: dir,
      config: {
        title_filter: { positive: ['engineer'] },
        job_discovery: { enabled: true, providers: { fake: { enabled: true } } },
      },
      adapters: [{
        id: 'fake',
        kind: 'api',
        meta: { id: 'fake', kind: 'api', regions: ['remote_worldwide'] },
        missingEnv: [],
        fetch: async () => [{
          title: 'Software Engineer',
          company: 'FakeCo',
          location: 'Remote Worldwide',
          remote: true,
          url: 'https://example.com/job-1',
          source: 'fake',
          source_id: 'job-1',
        }],
      }],
      argv: { 'dry-run': true, provider: 'fake', region: 'remote' },
      log: () => {},
    });

    assert.equal(readFileSync(path.join(dir, 'data', 'pipeline.md'), 'utf-8'), '# Pipeline\n\n## Pendientes\n\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--provider remoteok runs only RemoteOK', async () => {
  const result = await runGlobalScan({
    config: {
      title_filter: { positive: ['engineer'] },
      job_discovery: { enabled: true, providers: { remoteok: { enabled: true }, remotive: { enabled: true } } },
    },
    adapters: [
      { id: 'remoteok', kind: 'api', meta: { id: 'remoteok', kind: 'api' }, missingEnv: [], fetch: async () => [] },
      { id: 'remotive', kind: 'api', meta: { id: 'remotive', kind: 'api' }, missingEnv: [], fetch: async () => [] },
    ],
    argv: { provider: 'remoteok', 'dry-run': true },
    log: () => {},
  });

  assert.deepEqual(result.providerResults.map((r) => r.provider), ['remoteok']);
});

test('--region pakistan,gcc,remote filters final jobs', async () => {
  const result = await runGlobalScan({
    config: {
      title_filter: { positive: ['engineer'] },
      job_discovery: { enabled: true, providers: { fake: { enabled: true } } },
    },
    adapters: [{
      id: 'fake',
      kind: 'api',
      meta: { id: 'fake', kind: 'api' },
      missingEnv: [],
      fetch: async () => [
        { title: 'Software Engineer', company: 'A', location: 'Lahore, Pakistan', url: 'https://example.com/a', source: 'fake' },
        { title: 'Software Engineer', company: 'B', location: 'Dubai, UAE', url: 'https://example.com/b', source: 'fake' },
        { title: 'Software Engineer', company: 'C', location: 'Remote Worldwide', remote: true, url: 'https://example.com/c', source: 'fake' },
        { title: 'Software Engineer', company: 'D', location: 'London, UK', url: 'https://example.com/d', source: 'fake' },
      ],
    }],
    argv: { provider: 'fake', region: 'pakistan,gcc,remote', 'dry-run': true },
    log: () => {},
  });

  assert.deepEqual(result.newJobs.map((j) => j.company), ['A', 'B', 'C']);
});

test('SmartRecruiters zero-result response returns no jobs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ totalFound: 0, content: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const jobs = await fetchSmartRecruiters(
      { companies: ['invalid'], max_pages: 1 },
      { rateLimiter: { acquire: async () => () => {} }, log: () => {} },
    );
    assert.deepEqual(jobs, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid jobs without title or URL are skipped', async () => {
  const result = await runGlobalScan({
    config: {
      title_filter: { positive: [] },
      job_discovery: { enabled: true, providers: { fake: { enabled: true } } },
    },
    adapters: [{
      id: 'fake',
      kind: 'api',
      meta: { id: 'fake', kind: 'api' },
      missingEnv: [],
      fetch: async () => [
        { title: '', company: 'Bad', location: 'Remote', url: 'https://example.com/no-title', source: 'fake' },
        { title: 'Engineer', company: 'Bad', location: 'Remote', url: '', source: 'fake' },
        { title: 'Engineer', company: 'Good', location: 'Remote Worldwide', url: 'https://example.com/good', source: 'fake' },
      ],
    }],
    argv: { provider: 'fake', 'dry-run': true },
    log: () => {},
  });

  assert.equal(result.invalidSkipped, 2);
  assert.deepEqual(result.newJobs.map((j) => j.company), ['Good']);
});

test('fetch cache is used when fresh and bypassed with no-cache', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'career-ops-cache-'));
  const originalFetch = globalThis.fetch;
  const oldCacheRoot = process.env.CAREER_OPS_CACHE_DIR;
  const oldNoCache = process.env.CAREER_OPS_NO_CACHE;
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  process.env.CAREER_OPS_CACHE_DIR = path.join(dir, 'job-sources');
  delete process.env.CAREER_OPS_NO_CACHE;

  try {
    const first = await fetchWithRetry('https://example.com/jobs', { accept: 'json', cacheTtlMs: 60_000 });
    const second = await fetchWithRetry('https://example.com/jobs', { accept: 'json', cacheTtlMs: 60_000 });
    process.env.CAREER_OPS_NO_CACHE = '1';
    const third = await fetchWithRetry('https://example.com/jobs', { accept: 'json', cacheTtlMs: 60_000 });

    assert.equal(first.calls, 1);
    assert.equal(second.calls, 1);
    assert.equal(third.calls, 2);
    assert.equal(calls, 2);
    assert.equal(existsSync(path.join(dir, 'job-sources')), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldCacheRoot == null) delete process.env.CAREER_OPS_CACHE_DIR;
    else process.env.CAREER_OPS_CACHE_DIR = oldCacheRoot;
    if (oldNoCache == null) delete process.env.CAREER_OPS_NO_CACHE;
    else process.env.CAREER_OPS_NO_CACHE = oldNoCache;
    rmSync(dir, { recursive: true, force: true });
  }
});
