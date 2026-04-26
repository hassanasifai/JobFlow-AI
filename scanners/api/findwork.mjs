// scanners/api/findwork.mjs — https://findwork.dev/developers
//
// Free token-based API; mostly worldwide tech remote.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'findwork',
  kind: 'api',
  regions: ['worldwide-remote', 'worldwide'],
  supports: { queries: true, locations: true, remote_only: true, max_pages: true },
  presets: {
    queries: [],
    locations: [],
  },
  schema: {
    api_token: 'string  REQUIRED — sign up at findwork.dev (free)',
    queries: 'string[]   ?search=',
    locations: 'string[] ?location=',
    remote_only: 'boolean ?remote=true',
    max_pages: 'number   default 5 (×100)',
  },
  docs: 'https://findwork.dev/developers/',
  requiresKey: true,
  envKeys: ['FINDWORK_TOKEN'],
  signupUrl: 'https://findwork.dev/developers/',
  freeTier: 'Free token · worldwide tech focus',
};

const BASE = 'https://findwork.dev/api/jobs/';

export default async function fetchFindwork(config = {}, ctx) {
  const token = config.api_token || process.env.FINDWORK_TOKEN;
  if (!token) { ctx.log('warn', 'findwork: api_token missing; skipping'); return []; }

  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const maxPages = config.max_pages ?? 5;

  const headers = { 'Authorization': `Token ${token}` };
  const out = [];
  const seen = new Set();

  for (const q of queries) {
    for (const loc of locations) {
      let next = `${BASE}?` + new URLSearchParams({
        ...(q ? { search: q } : {}),
        ...(loc ? { location: loc } : {}),
        ...(config.remote_only ? { remote: 'true' } : {}),
        ordering: '-date_posted',
      });
      for (let page = 0; page < maxPages && next; page++) {
        const release = await ctx.rateLimiter.acquire(next);
        let data;
        try { data = await fetchWithRetry(next, { accept: 'json', headers }); }
        finally { release(); }

        for (const j of (data?.results || [])) {
          const link = j.url || j.apply_url;
          if (!link || seen.has(link)) continue;
          seen.add(link);
          out.push(createJob({
            source: 'findwork',
            source_kind: 'api',
            url: link,
            title: j.role,
            company: j.company_name,
            location: j.location || (j.remote ? 'Remote' : ''),
            remote: !!j.remote,
            description: stripHtml(j.text || ''),
            employment_type: j.employment_type ? String(j.employment_type).toUpperCase() : null,
            posted_at: j.date_posted,
            tags: j.keywords || [],
            raw: j,
          }));
        }
        next = data?.next || null;
      }
    }
  }
  return out;
}
