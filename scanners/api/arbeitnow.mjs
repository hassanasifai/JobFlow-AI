// scanners/api/arbeitnow.mjs — https://www.arbeitnow.com/api/job-board-api
//
// Public, paginated, no auth. Strong EU + worldwide remote coverage.
// Server-side filtering is limited; queries are matched client-side.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'arbeitnow',
  kind: 'api',
  regions: ['europe', 'worldwide-remote'],
  supports: { queries: true, tags: true, max_pages: true },
  presets: {
    tags: [],
    queries: [],
  },
  schema: {
    queries: 'string[]   // optional keywords; matched against title+description',
    tags: 'string[]      // optional tag match',
    max_pages: 'number   // default 5; each page ~100 jobs',
  },
  docs: 'https://documenter.getpostman.com/view/18545278/UVJbJdKh',
};

const BASE = 'https://www.arbeitnow.com/api/job-board-api';

export default async function fetchArbeitnow(config = {}, ctx) {
  const maxPages = config.max_pages ?? 5;
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const tags = (config.tags || []).map((t) => t.toLowerCase()).filter(Boolean);

  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}?page=${page}`;
    const release = await ctx.rateLimiter.acquire(url);
    try {
      const data = await fetchWithRetry(url, { accept: 'json' });
      const jobs = data?.data || [];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const title = j.title || '';
        const desc = stripHtml(j.description || '');
        const blob = `${title} ${desc}`.toLowerCase();
        if (queries.length && !queries.some((q) => blob.includes(q))) continue;
        const jobTags = (j.tags || []).map((t) => String(t).toLowerCase());
        if (tags.length && !tags.some((t) => jobTags.includes(t))) continue;

        out.push(createJob({
          source: 'arbeitnow',
          source_kind: 'api',
          url: j.url || j.apply_url,
          title,
          company: j.company_name,
          location: j.location || (j.remote ? 'Remote' : ''),
          remote: !!j.remote,
          region: j.remote ? ['worldwide-remote'] : ['europe'],
          description: desc,
          employment_type: (Array.isArray(j.job_types) ? j.job_types[0] : j.job_types) || null,
          posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
          tags: j.tags || [],
          raw: j,
        }));
      }
      const lastPage = data?.meta?.last_page || data?.last_page;
      if (lastPage && page >= lastPage) break;
    } finally { release(); }
  }
  return out;
}
