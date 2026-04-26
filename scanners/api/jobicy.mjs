// scanners/api/jobicy.mjs — https://jobicy.com/api/v2/remote-jobs
//
// Free public JSON v2 API. Supports geo + industry + tag filters server-side.
//
// Note: live testing (2026-04) shows Jobicy's `geo` parameter does NOT include
// "middle-east" or "pakistan" — those slugs return either an "invalid geoSlug"
// error or zero results. Treat jobicy as worldwide-remote with industry +
// seniority filters only. For Gulf/PK use the ATS adapters with confirmed
// regional company slugs.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'jobicy',
  kind: 'api',
  regions: ['worldwide-remote'],
  supports: { queries: true, geo: true, industries: true, tags: true },
  presets: {
    // Confirmed working geo slugs (verified 2026-04). "middle-east" is rejected
    // by the API and "pakistan" returns no jobs — both removed.
    geo: [
      'usa', 'canada', 'uk', 'europe', 'apac', 'latam', 'africa',
    ],
    industries: [
      'business', 'copywriting', 'customer-service', 'data-science', 'design',
      'devops-sysadmin', 'finance-legal', 'human-resources', 'marketing',
      'product', 'project-management', 'sales-business', 'software-dev',
      'support', 'qa', 'translation',
    ],
    tags: [],
    queries: [],
  },
  schema: {
    queries: 'string[]    // matched client-side against title/description',
    geo: 'string[]        // server-side geo slugs',
    industries: 'string[] // server-side industry slugs',
    tags: 'string[]       // server-side tag slugs',
    count: 'number        // per request, default 50',
  },
  docs: 'https://jobicy.com/jobs-rss-feed',
};

const BASE = 'https://jobicy.com/api/v2/remote-jobs';

export default async function fetchJobicy(config = {}, ctx) {
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const geos = config.geo?.length ? config.geo : [''];
  const industries = config.industries?.length ? config.industries : [''];
  const tags = config.tags?.length ? config.tags : [''];
  const count = config.count ?? 50;

  const out = [];
  const seen = new Set();

  for (const g of geos) {
    for (const ind of industries) {
      for (const tag of tags) {
        const params = new URLSearchParams();
        params.set('count', String(count));
        if (g) params.set('geo', g);
        if (ind) params.set('industry', ind);
        if (tag) params.set('tag', tag);
        const url = `${BASE}?${params}`;

        const release = await ctx.rateLimiter.acquire(url);
        try {
          const data = await fetchWithRetry(url, { accept: 'json' });
          const jobs = data?.jobs || [];
          for (const j of jobs) {
            if (!j.url || seen.has(j.url)) continue;
            seen.add(j.url);
            const title = j.jobTitle || '';
            const desc = stripHtml(j.jobExcerpt || j.jobDescription || '');
            const blob = `${title} ${desc}`.toLowerCase();
            if (queries.length && !queries.some((q) => blob.includes(q))) continue;
            out.push(createJob({
              source: 'jobicy',
              source_kind: 'api',
              url: j.url,
              title,
              company: j.companyName,
              location: (j.jobGeo || j.jobIndustry || 'Anywhere'),
              remote: true,
              region: ['worldwide-remote'],
              description: desc,
              salary_min: j.annualSalaryMin ? Number(j.annualSalaryMin) : null,
              salary_max: j.annualSalaryMax ? Number(j.annualSalaryMax) : null,
              salary_currency: j.salaryCurrency || null,
              employment_type: j.jobType ? String(j.jobType).toUpperCase().replace(/-/g, '_') : null,
              posted_at: j.pubDate,
              tags: [].concat(j.jobIndustry || [], j.jobLevel || []).filter(Boolean),
              raw: j,
            }));
          }
        } finally { release(); }
      }
    }
  }
  return out;
}
