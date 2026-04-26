// scanners/api/himalayas.mjs — https://himalayas.app/jobs/api
//
// Largest single source (~101k active jobs). Paginated, no auth.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'himalayas',
  kind: 'api',
  regions: ['worldwide-remote'],
  supports: { queries: true, categories: true, max_pages: true, seniority: true },
  presets: {
    categories: [
      'engineering', 'data', 'design', 'product', 'marketing', 'sales',
      'support', 'operations', 'finance', 'people', 'writing', 'devops',
      'security', 'qa', 'machine-learning', 'mobile',
    ],
    seniority: ['entry', 'mid', 'senior', 'lead', 'principal', 'manager', 'director'],
    queries: [],
  },
  schema: {
    queries: 'string[]    // client-side keyword match',
    categories: 'string[] // client-side filter on categories array',
    seniority: 'string[]  // client-side filter on seniority field',
    max_pages: 'number    // default 10; up to ~5000 jobs',
    page_size: 'number    // default 50',
  },
  docs: 'https://himalayas.app/jobs',
};

const BASE = 'https://himalayas.app/jobs/api';

export default async function fetchHimalayas(config = {}, ctx) {
  const maxPages = config.max_pages ?? 10;
  const limit = config.page_size ?? 50;
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const cats = (config.categories || []).map((c) => c.toLowerCase()).filter(Boolean);
  const seniority = (config.seniority || []).map((s) => s.toLowerCase()).filter(Boolean);

  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}?offset=${page * limit}&limit=${limit}`;
    const release = await ctx.rateLimiter.acquire(url);
    try {
      const data = await fetchWithRetry(url, { accept: 'json' });
      const jobs = data?.jobs || [];
      if (jobs.length === 0) break;

      for (const j of jobs) {
        const title = j.title || '';
        const desc = stripHtml(j.excerpt || j.description || '');
        const blob = `${title} ${desc}`.toLowerCase();
        if (queries.length && !queries.some((q) => blob.includes(q))) continue;

        const jobCats = (j.categories || []).map((c) => String(c).toLowerCase());
        if (cats.length && !cats.some((c) => jobCats.includes(c))) continue;

        if (seniority.length && !seniority.includes(String(j.seniority || '').toLowerCase())) continue;

        const applyUrl = j.applicationLink || j.guid || `https://himalayas.app/companies/${j.companySlug || ''}/jobs/${j.slug || j.id}`;
        out.push(createJob({
          source: 'himalayas',
          source_kind: 'api',
          url: applyUrl,
          title,
          company: j.companyName || j.company || '',
          location: (j.locationRestrictions || []).join(', ') || (j.timezones || []).join(', ') || 'Anywhere',
          remote: true,
          region: ['worldwide-remote'],
          description: desc,
          salary_min: j.minSalary || null,
          salary_max: j.maxSalary || null,
          salary_currency: j.currency || (j.minSalary ? 'USD' : null),
          employment_type: j.employmentType ? String(j.employmentType).toUpperCase() : null,
          posted_at: j.publishedAt || j.createdAt,
          expires_at: j.expiryDate || null,
          tags: [].concat(j.categories || [], j.seniority ? [j.seniority] : []),
          raw: j,
        }));
      }
      if (jobs.length < limit) break;
    } finally { release(); }
  }
  return out;
}
