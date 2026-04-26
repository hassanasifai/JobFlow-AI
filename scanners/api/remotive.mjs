// scanners/api/remotive.mjs — https://remotive.com/api/remote-jobs
//
// Free public JSON API. No auth. Supports search + category filtering.
// User-supplied queries / categories / company are passed through as-is —
// the API returns 200 even on unknown values, so free-text input is safe.

import { fetchWithRetry, createJob, parseSalaryText, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'remotive',
  kind: 'api',
  regions: ['worldwide-remote'],
  supports: { queries: true, categories: true, companies: true, locations: false, countries: false },
  presets: {
    // Known Remotive category slugs. Frontend can render these as chips;
    // free-text values are also passed through untouched.
    categories: [
      'software-dev', 'customer-support', 'design', 'marketing', 'sales-business',
      'product', 'business', 'data', 'devops-sysadmin', 'finance-legal',
      'human-resources', 'qa', 'writing', 'all-others',
    ],
    queries: [], // open free-text
  },
  schema: {
    queries: 'string[]   // optional search terms (passed to ?search=)',
    categories: 'string[] // optional category slugs (passed to ?category=)',
    companies: 'string[] // optional company-name filter (passed to ?company_name=)',
    limit: 'number      // optional, default 100',
  },
  docs: 'https://remotive.com/api-documentation',
};

const BASE = 'https://remotive.com/api/remote-jobs';

export default async function fetchRemotive(config = {}, ctx) {
  const queries = config.queries?.length ? config.queries : [''];
  const categories = config.categories?.length ? config.categories : [''];
  const companies = config.companies?.length ? config.companies : [''];
  const limit = config.limit ?? 100;

  const out = [];
  const seen = new Set();

  for (const q of queries) {
    for (const c of categories) {
      for (const comp of companies) {
        const params = new URLSearchParams();
        if (q) params.set('search', q);
        if (c) params.set('category', c);
        if (comp) params.set('company_name', comp);
        if (limit) params.set('limit', String(limit));
        const url = `${BASE}${params.toString() ? '?' + params : ''}`;

        const release = await ctx.rateLimiter.acquire(url);
        try {
          const data = await fetchWithRetry(url, { accept: 'json' });
          const jobs = data?.jobs || [];
          for (const j of jobs) {
            if (!j.url || seen.has(j.url)) continue;
            seen.add(j.url);
            const sal = parseSalaryText(j.salary);
            out.push(createJob({
              source: 'remotive',
              source_kind: 'api',
              url: j.url,
              title: j.title,
              company: j.company_name,
              location: j.candidate_required_location || 'Anywhere',
              remote: true,
              region: ['worldwide-remote'],
              description: stripHtml(j.description),
              salary_min: sal?.min ?? null,
              salary_max: sal?.max ?? null,
              salary_currency: sal?.currency ?? null,
              employment_type: j.job_type ? j.job_type.toUpperCase().replace('-', '_') : null,
              posted_at: j.publication_date,
              tags: j.tags || [],
              raw: j,
            }));
          }
        } finally { release(); }
      }
    }
  }
  return out;
}
