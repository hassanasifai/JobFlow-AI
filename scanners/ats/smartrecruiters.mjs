// scanners/ats/smartrecruiters.mjs — https://api.smartrecruiters.com/v1/companies/{name}/postings
//
// Public read API for posting boards.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'smartrecruiters',
  kind: 'ats',
  regions: ['worldwide'],
  supports: { companies: true, max_pages: true },
  presets: {
    companies: [],
  },
  schema: {
    companies: 'string[] SmartRecruiters company identifiers',
    max_pages: 'number   default 5 (×100 = 500)',
  },
  docs: 'https://developers.smartrecruiters.com/reference/postingsdetail',
  requiresInputs: ['companies'],
};

const BASE = 'https://api.smartrecruiters.com/v1/companies';

export default async function fetchSmartRecruiters(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];
  const maxPages = config.max_pages ?? 5;

  const out = [];
  for (const name of companies) {
    for (let page = 0; page < maxPages; page++) {
      const url = `${BASE}/${encodeURIComponent(name)}/postings?limit=100&offset=${page * 100}`;
      const release = await ctx.rateLimiter.acquire(url);
      let data;
      try { data = await fetchWithRetry(url, { accept: 'json' }); }
      catch (err) { ctx.log('warn', `smartrecruiters ${name}: ${err.message}`); release(); break; }
      finally { release(); }

      const items = data?.content || [];
      if (Number(data?.totalFound) <= 0) {
        ctx.log('info', `smartrecruiters ${name}: no postings found`);
        break;
      }
      if (items.length === 0) break;
      for (const j of items) {
        const detailUrl = j.applyUrl || j.ref || `https://jobs.smartrecruiters.com/${name}/${j.id}`;
        out.push(createJob({
          source: 'smartrecruiters',
          source_kind: 'ats',
          url: detailUrl,
          title: j.name,
          company: name,
          location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '),
          source_id: j.id,
          remote: !!j.location?.remote,
          description: stripHtml(j.jobAd?.sections?.jobDescription?.text || ''),
          description_html: j.jobAd?.sections?.jobDescription?.text || '',
          employment_type: j.typeOfEmployment?.label ? String(j.typeOfEmployment.label).toUpperCase() : null,
          posted_at: j.releasedDate || j.createdOn,
          tags: [j.department?.label, j.industry?.label].filter(Boolean),
          raw: j,
        }));
      }
      if (items.length < 100) break;
    }
  }
  return out;
}
