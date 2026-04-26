// scanners/ats/recruitee.mjs — https://api.recruitee.com/c/{company_id}/offers
//
// Public careers API. For older subdomain-only boards we fallback to
// https://{company}.recruitee.com/api/offers/. No auth.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'recruitee',
  kind: 'ats',
  regions: ['worldwide', 'europe'],
  supports: { companies: true },
  presets: { companies: [] },
  schema: { companies: 'string[]  Recruitee subdomain slugs' },
  docs: 'https://docs.recruitee.com/',
  requiresInputs: ['companies'],
};

export default async function fetchRecruitee(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  const out = [];
  for (const slug of companies) {
    const url = `https://api.recruitee.com/c/${encodeURIComponent(slug)}/offers`;
    const release = await ctx.rateLimiter.acquire(url);
    let data;
    try { data = await fetchWithRetry(url, { accept: 'json' }); }
    catch (err) {
      release();
      const fallback = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
      const fallbackRelease = await ctx.rateLimiter.acquire(fallback);
      try { data = await fetchWithRetry(fallback, { accept: 'json' }); }
      catch (fallbackErr) { ctx.log('warn', `recruitee ${slug}: ${err.message}; fallback: ${fallbackErr.message}`); continue; }
      finally { fallbackRelease(); }
    }
    finally { release(); }

    for (const j of (data?.offers || [])) {
      out.push(createJob({
        source: 'recruitee',
        source_kind: 'ats',
        url: j.careers_url || j.careers_apply_url,
        title: j.title,
        company: j.company_name || slug,
        location: [j.city, j.country].filter(Boolean).join(', '),
        source_id: j.id || j.slug,
        remote: !!j.remote || j.workplace_type === 'remote',
        description: stripHtml(`${j.description || ''} ${j.requirements || ''}`),
        description_html: `${j.description || ''} ${j.requirements || ''}`,
        employment_type: j.employment_type_code ? String(j.employment_type_code).toUpperCase() : null,
        posted_at: j.created_at,
        tags: [j.category, j.department, ...(j.tags || [])].filter(Boolean),
        raw: j,
      }));
    }
  }
  return out;
}
