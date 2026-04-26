// scanners/ats/workable.mjs — Workable public account endpoints
//
// Preferred public endpoint: https://www.workable.com/api/accounts/{slug}?details=true
// Fallback widget endpoint: https://apply.workable.com/api/v1/widget/accounts/{slug}

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'workable',
  kind: 'ats',
  regions: ['worldwide'],
  supports: { companies: true },
  presets: {
    companies: [],
  },
  schema: { companies: 'string[]   list of Workable account slugs' },
  docs: 'https://workable.readme.io/reference/jobs-list',
  requiresInputs: ['companies'],
};

export default async function fetchWorkable(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  const out = [];
  for (const slug of companies) {
    const url = `https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`;
    const release = await ctx.rateLimiter.acquire(url);
    let data;
    try { data = await fetchWithRetry(url, { accept: 'json' }); }
    catch (err) {
      release();
      const fallback = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`;
      const fallbackRelease = await ctx.rateLimiter.acquire(fallback);
      try { data = await fetchWithRetry(fallback, { accept: 'json' }); }
      catch (fallbackErr) { ctx.log('warn', `workable ${slug}: ${err.message}; fallback: ${fallbackErr.message}`); continue; }
      finally { fallbackRelease(); }
    }
    finally { release(); }

    const jobs = data?.jobs || data?.results || [];
    for (const j of jobs) {
      const url2 = j.url || j.application_url || (j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}` : null);
      if (!url2) continue;
      const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') || j.location?.location_str || '';
      out.push(createJob({
        source: 'workable',
        source_kind: 'ats',
        url: url2,
        title: j.title,
        company: data.name || slug,
        location: loc,
        source_id: j.id || j.shortcode,
        remote: !!j.remote || !!j.telecommuting || j.location?.workplace === 'remote' || j.workplace_type === 'remote',
        remote_scope: j.workplace_type === 'remote' ? undefined : null,
        description: stripHtml(j.description || j.full_description || ''),
        description_html: j.description || j.full_description || '',
        employment_type: j.employment_type ? String(j.employment_type).toUpperCase() : null,
        posted_at: j.published_on || j.created_at,
        tags: [j.department, j.industry, ...(j.keywords || [])].filter(Boolean),
        raw: j,
      }));
    }
  }
  return out;
}
