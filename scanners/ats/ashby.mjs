// scanners/ats/ashby.mjs — https://api.ashbyhq.com/posting-api/job-board/{id}
//
// No auth. id is the company's Ashby slug. Pass `?includeCompensation=true` to
// get salary fields when employers publish them.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'ashby',
  kind: 'ats',
  regions: ['worldwide'],
  supports: { companies: true, include_compensation: true },
  presets: {
    companies: ['ashby', 'linear', 'rippling', 'mercury', 'replit', 'whop'],
  },
  schema: {
    companies: 'string[]            list of Ashby board IDs',
    include_compensation: 'boolean  default true',
  },
  docs: 'https://developers.ashbyhq.com/reference/job-board-api',
  requiresInputs: ['companies'],
};

export default async function fetchAshby(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  const includeComp = config.include_compensation !== false;
  if (companies.length === 0) return [];

  const out = [];
  for (const id of companies) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(id)}?includeCompensation=${includeComp}`;
    const release = await ctx.rateLimiter.acquire(url);
    let data;
    try { data = await fetchWithRetry(url, { accept: 'json' }); }
    catch (err) { ctx.log('warn', `ashby ${id}: ${err.message}`); release(); continue; }
    finally { release(); }

    for (const j of (data?.jobs || [])) {
      const comp = j.compensation || {};
      const summary = comp.compensationTierSummary;
      const tier = Array.isArray(summary) ? summary.find(Boolean) : (summary && typeof summary === 'object' ? summary : null);
      out.push(createJob({
        source: 'ashby',
        source_kind: 'ats',
        url: j.jobUrl || j.applyUrl,
        title: j.title,
        company: j.companyName || data.companyName || id,
        location: j.location || (j.address?.postalAddress?.addressLocality || ''),
        source_id: j.id,
        remote: !!j.isRemote || /remote/i.test(j.location || ''),
        description: stripHtml(j.descriptionHtml || j.description || ''),
        description_html: j.descriptionHtml || j.description || '',
        employment_type: j.employmentType ? String(j.employmentType).toUpperCase() : null,
        salary_min: tier?.compensationTierLowerBound || null,
        salary_max: tier?.compensationTierUpperBound || null,
        salary_currency: tier?.currencyCode || null,
        posted_at: j.publishedAt,
        tags: [j.department, j.team].filter(Boolean),
        raw: j,
      }));
    }
  }
  return out;
}
