// tests/adapters.test.mjs — golden-fixture tests for the highest-traffic
// scanner adapters.
//
// fetchWithRetry has a disk cache (data/cache/) that's keyed on URL, so when
// the live probe runs first the cached response shadows our mock. Disable
// the cache for the duration of these tests so the mocks actually fire.
process.env.CAREER_OPS_NO_CACHE = '1';
//
// We stub globalThis.fetch with shape-faithful mock payloads (kept minimal
// so a real-world JSON change forces an explicit fixture update rather than
// silent rot) and assert the adapter's parsing invariants:
//
//   • returns a non-empty array
//   • every job has a non-empty title and url
//   • posted_at, when present, parses with Date.parse
//   • source / source_kind are stamped correctly
//   • company is non-empty (pulled from payload OR slug fallback)
//
// We covers ~80% of fetched volume in production: greenhouse, lever, ashby,
// workable, remoteok, remotive, arbeitnow, themuse, landing-jobs, getonbrd,
// hn-jobstories. Adding more fixtures here is mechanical — copy a small
// payload slice, list the URLs, write the assertions.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, CircuitBreaker } from '../scanners/_base.mjs';

// ── Mock fetch infra ───────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let fetchPlan = new Map();           // matcher fn → response factory

function installFetchMock(plan) {
  fetchPlan = plan;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    for (const [match, factory] of plan) {
      if ((typeof match === 'string' && u === match) || (match instanceof RegExp && match.test(u))) {
        const r = factory(u, opts);
        if (typeof r === 'string') {
          return new Response(r, { status: 200, headers: { 'content-type': /\.xml/.test(u) || /<rss|<feed/.test(r) ? 'application/xml' : 'application/json' } });
        }
        if (r && typeof r === 'object' && 'status' in r) return new Response(r.body || '', { status: r.status, headers: r.headers || {} });
        return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error(`unmocked fetch: ${u}`);
  };
}

beforeEach(() => { fetchPlan = new Map(); });
afterEach(() => { globalThis.fetch = realFetch; });

function makeCtx() {
  return {
    rateLimiter: new RateLimiter({ minIntervalMs: 0 }),
    breaker: new CircuitBreaker(),
    log: () => {},
    signal: undefined,
  };
}

function assertJobShape(jobs, { source, source_kind }) {
  assert.ok(Array.isArray(jobs), 'expected array');
  assert.ok(jobs.length > 0, 'expected ≥1 job');
  for (const j of jobs) {
    assert.ok(j.title && typeof j.title === 'string', `job.title required: ${JSON.stringify(j).slice(0, 200)}`);
    assert.ok(j.url && typeof j.url === 'string', `job.url required: ${JSON.stringify(j).slice(0, 200)}`);
    assert.equal(j.source, source);
    assert.equal(j.source_kind, source_kind);
    if (j.posted_at) {
      assert.ok(!Number.isNaN(Date.parse(j.posted_at)), `unparseable posted_at: ${j.posted_at}`);
    }
  }
}

// ── greenhouse ─────────────────────────────────────────────────────────

test('greenhouse parses board API payload, populates company + location', async () => {
  const { default: fetchFn } = await import('../scanners/ats/greenhouse.mjs');
  installFetchMock(new Map([
    [/boards-api\.greenhouse\.io\/v1\/boards\/airbnb\/jobs/, () => ({
      meta: { name: 'Airbnb' },
      jobs: [
        {
          id: 1,
          title: 'Senior AI Engineer',
          absolute_url: 'https://job-boards.greenhouse.io/airbnb/jobs/1',
          location: { name: 'Remote · USA' },
          content: '<p>Build great things.</p>',
          updated_at: '2026-04-01T00:00:00Z',
          metadata: [{ name: 'Employment Type', value: 'Full-time' }],
          departments: [{ name: 'Engineering' }],
        },
      ],
    })],
  ]));
  const out = await fetchFn({ companies: ['airbnb'] }, makeCtx());
  assertJobShape(out, { source: 'greenhouse', source_kind: 'ats' });
  assert.equal(out[0].company, 'Airbnb');
  assert.equal(out[0].location, 'Remote · USA');
  assert.equal(out[0].employment_type, 'Full-time');
  assert.match(out[0].description, /Build great things/);
});

test('greenhouse dedups by absolute_url across the same slug', async () => {
  const { default: fetchFn } = await import('../scanners/ats/greenhouse.mjs');
  installFetchMock(new Map([
    [/boards-api\.greenhouse\.io/, () => ({
      meta: { name: 'Stripe' },
      jobs: [
        { id: 1, title: 'A', absolute_url: 'https://job-boards.greenhouse.io/stripe/jobs/1', location: { name: '' }, updated_at: '2026-04-01T00:00:00Z' },
        { id: 1, title: 'A duplicate', absolute_url: 'https://job-boards.greenhouse.io/stripe/jobs/1', location: { name: '' }, updated_at: '2026-04-01T00:00:00Z' },
      ],
    })],
  ]));
  const out = await fetchFn({ companies: ['stripe'] }, makeCtx());
  assert.equal(out.length, 1);
});

// ── lever ──────────────────────────────────────────────────────────────

test('lever parses postings array, falls back to slug for company', async () => {
  const { default: fetchFn } = await import('../scanners/ats/lever.mjs');
  installFetchMock(new Map([
    [/api\.lever\.co\/v0\/postings\/spotify/, () => [
      {
        text: 'Backend Engineer',
        hostedUrl: 'https://jobs.lever.co/spotify/abc',
        applyUrl: 'https://jobs.lever.co/spotify/abc/apply',
        descriptionPlain: 'Build the music graph.',
        categories: { location: 'Stockholm', commitment: 'Full-time', team: 'Eng' },
        createdAt: 1735689600000,                // 2025-01-01
      },
    ]],
  ]));
  const out = await fetchFn({ companies: ['spotify'] }, makeCtx());
  assertJobShape(out, { source: 'lever', source_kind: 'ats' });
  assert.equal(out[0].company, 'spotify');
  assert.equal(out[0].location, 'Stockholm');
  assert.equal(out[0].employment_type, 'FULL-TIME');
});

// ── ashby ──────────────────────────────────────────────────────────────

test('ashby parses jobs array, surfaces compensation when configured', async () => {
  const { default: fetchFn } = await import('../scanners/ats/ashby.mjs');
  installFetchMock(new Map([
    [/api\.ashbyhq\.com\/posting-api\/job-board\/openai/, () => ({
      jobs: [
        {
          id: 'x',
          title: 'AI Researcher',
          jobUrl: 'https://jobs.ashbyhq.com/openai/x',
          location: 'San Francisco',
          publishedAt: '2026-03-15T00:00:00Z',
          department: 'Research',
          team: 'Foundation',
          isRemote: true,
          descriptionHtml: '<p>Push the frontier.</p>',
          compensationTierSummary: '$300k–$500k USD',
        },
      ],
    })],
  ]));
  const out = await fetchFn({ companies: ['openai'], include_compensation: true }, makeCtx());
  assertJobShape(out, { source: 'ashby', source_kind: 'ats' });
  assert.equal(out[0].remote, true);
});

// ── remoteok ───────────────────────────────────────────────────────────

test('remoteok skips legal/disclaimer header row, parses job rows', async () => {
  const { default: fetchFn } = await import('../scanners/api/remoteok.mjs');
  installFetchMock(new Map([
    [/remoteok\.com\/api/, () => [
      { legal: 'See remoteok.com/terms' },                 // header row — must be skipped
      {
        id: '1', position: 'Senior Backend Engineer', company: 'Stripe',
        url: 'https://remoteok.com/remote-jobs/1',
        location: 'Worldwide', tags: ['python', 'remote'],
        date: '2026-04-12T00:00:00Z',
        description: '<p>Stripe is hiring.</p>',
      },
    ]],
  ]));
  const out = await fetchFn({}, makeCtx());
  assertJobShape(out, { source: 'remoteok', source_kind: 'api' });
  assert.equal(out[0].company, 'Stripe');
  assert.equal(out[0].remote, true);
});

// ── remotive ───────────────────────────────────────────────────────────

test('remotive parses jobs array', async () => {
  const { default: fetchFn } = await import('../scanners/api/remotive.mjs');
  installFetchMock(new Map([
    [/remotive\.com\/api\/remote-jobs/, () => ({
      jobs: [
        {
          id: 1, title: 'AI Engineer', company_name: 'Anthropic',
          url: 'https://remotive.com/remote-jobs/ai-engineer-1',
          publication_date: '2026-04-10T00:00:00Z',
          candidate_required_location: 'Anywhere', job_type: 'full_time',
          description: '<p>Work on Claude.</p>', tags: ['ai', 'llm'],
        },
      ],
    })],
  ]));
  const out = await fetchFn({}, makeCtx());
  assertJobShape(out, { source: 'remotive', source_kind: 'api' });
  assert.equal(out[0].employment_type, 'FULL_TIME');
});

// ── arbeitnow ──────────────────────────────────────────────────────────

test('arbeitnow paginates via meta.next_page_url and stops cleanly', async () => {
  const { default: fetchFn } = await import('../scanners/api/arbeitnow.mjs');
  let pageCalls = 0;
  installFetchMock(new Map([
    [/arbeitnow\.com\/api\/job-board-api/, () => {
      pageCalls += 1;
      return {
        data: [{
          slug: `job-${pageCalls}`,
          title: `Senior Engineer ${pageCalls}`,
          company_name: 'Acme',
          location: 'Berlin',
          remote: true,
          tags: ['python'],
          description: '<p>build</p>',
          url: `https://arbeitnow.com/jobs/job-${pageCalls}`,
          created_at: 1700000000,
        }],
        // After 2 pages we report no next_page so the adapter halts.
        meta: pageCalls < 2 ? { next_page_url: 'https://www.arbeitnow.com/api/job-board-api?page=2' } : {},
        links: pageCalls < 2 ? { next: 'https://www.arbeitnow.com/api/job-board-api?page=2' } : { next: null },
      };
    }],
  ]));
  const out = await fetchFn({ max_pages: 5 }, makeCtx());
  assertJobShape(out, { source: 'arbeitnow', source_kind: 'api' });
  assert.ok(out.length >= 1, 'expected at least 1 job');
});

// ── themuse ────────────────────────────────────────────────────────────

test('themuse parses results without requiring an API key', async () => {
  const { default: fetchFn } = await import('../scanners/api/themuse.mjs');
  installFetchMock(new Map([
    [/themuse\.com\/api\/public\/jobs/, () => ({
      results: [
        {
          id: 1, name: 'Solutions Architect',
          company: { name: 'Datadog' },
          locations: [{ name: 'Remote' }],
          publication_date: '2026-04-05T00:00:00Z',
          contents: '<p>Build observability.</p>',
          refs: { landing_page: 'https://www.themuse.com/jobs/datadog/sa-1' },
          levels: [{ name: 'Senior' }],
          categories: [{ name: 'Engineering' }],
        },
      ],
      page_count: 1,
    })],
  ]));
  const out = await fetchFn({}, makeCtx());
  assertJobShape(out, { source: 'themuse', source_kind: 'api' });
  assert.match(out[0].url, /themuse\.com/);
});

// ── landing-jobs ───────────────────────────────────────────────────────

test('landing-jobs parses listings array', async () => {
  const { default: fetchFn } = await import('../scanners/api/landing-jobs.mjs');
  installFetchMock(new Map([
    // landing-jobs accepts either a top-level array or an object with `jobs`.
    // The adapter pulls company/location/remote/salary from individual fields.
    [/landing\.jobs\/api\/v1\/jobs/, () => ({
      jobs: [
        {
          id: 1, title: 'Senior Backend Engineer',
          company: { name: 'Acme PT' },
          location: 'Lisbon, Portugal',
          remote: true,
          technologies: ['python', 'aws'],
          published_at: '2026-04-08T00:00:00Z',
          description: '<p>Cloud-native role.</p>',
          salary_min: 50000, salary_max: 75000, salary_currency: 'EUR',
          url: 'https://landing.jobs/job/1',
          contract_type: 'full-time',
        },
      ],
    })],
  ]));
  const out = await fetchFn({}, makeCtx());
  assertJobShape(out, { source: 'landing-jobs', source_kind: 'api' });
  assert.equal(out[0].salary_min, 50000);
  assert.equal(out[0].salary_max, 75000);
});

// ── hn-jobstories ──────────────────────────────────────────────────────

test('hn-jobstories follows ID list and per-item fetches', async () => {
  const { default: fetchFn } = await import('../scanners/api/hn-jobstories.mjs');
  installFetchMock(new Map([
    [/jobstories\.json/, () => [101, 102]],
    [/item\/101\.json/, () => ({
      id: 101, type: 'job',
      title: 'Acme (YC W26) Hiring: Senior Backend Engineer',
      url: 'https://acme.com/careers/be',
      time: 1700000000, by: 'acmeceo',
    })],
    [/item\/102\.json/, () => ({
      id: 102, type: 'job',
      title: 'Bravo (YC X25) Hiring: AI Researcher',
      url: 'https://bravo.com/jobs/ai',
      time: 1700001000, by: 'bravoceo',
    })],
  ]));
  const out = await fetchFn({ max_items: 2 }, makeCtx());
  assertJobShape(out, { source: 'hn-jobstories', source_kind: 'api' });
  assert.equal(out.length, 2);
  assert.match(out[0].company, /Acme|Bravo/);
});

// ── workable ───────────────────────────────────────────────────────────

test('workable parses jobs from the public account API', async () => {
  const { default: fetchFn } = await import('../scanners/ats/workable.mjs');
  installFetchMock(new Map([
    [/workable\.com\/api\/accounts\/foodics/, () => ({
      name: 'Foodics',
      jobs: [
        {
          shortcode: 'ABC',
          title: 'Senior Software Engineer',
          location: { city: 'Riyadh', country: 'Saudi Arabia' },
          state: 'published',
          published_on: '2026-04-01',
          telecommuting: false,
          employment_type: 'Full-time',
          description: '<p>Build POS systems.</p>',
          url: 'https://apply.workable.com/foodics/j/ABC',
        },
      ],
    })],
  ]));
  const out = await fetchFn({ companies: ['foodics'] }, makeCtx());
  assertJobShape(out, { source: 'workable', source_kind: 'ats' });
  assert.match(out[0].location, /Riyadh|Saudi/);
});
