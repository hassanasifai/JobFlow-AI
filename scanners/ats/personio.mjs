// scanners/ats/personio.mjs — https://{company}.jobs.personio.com/xml
//
// EU-heavy ATS, exposes XML feed of all open positions.

import { fetchWithRetry, parseXml, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'personio',
  kind: 'ats',
  regions: ['europe', 'germany'],
  supports: { companies: true },
  presets: { companies: [] },
  schema: { companies: 'string[]  Personio company subdomains' },
  docs: 'https://developer.personio.de/docs/retrieving-open-job-positions',
  requiresInputs: ['companies'],
};

export default async function fetchPersonio(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  const out = [];
  for (const slug of companies) {
    const url = `https://${encodeURIComponent(slug)}.jobs.personio.com/xml`;
    const release = await ctx.rateLimiter.acquire(url);
    let xml;
    try { xml = await fetchWithRetry(url, { accept: 'text' }); }
    catch (err) {
      release();
      const fallback = `https://${encodeURIComponent(slug)}.jobs.personio.de/xml`;
      const fallbackRelease = await ctx.rateLimiter.acquire(fallback);
      try { xml = await fetchWithRetry(fallback, { accept: 'text' }); }
      catch (fallbackErr) { ctx.log('warn', `personio ${slug}: ${err.message}; fallback: ${fallbackErr.message}`); continue; }
      finally { fallbackRelease(); }
    }
    finally { release(); }

    const doc = parseXml(xml);
    const positions = doc?.['workzag-jobs']?.position || doc?.positions?.position || [];
    const arr = Array.isArray(positions) ? positions : [positions];
    for (const p of arr) {
      if (!p) continue;
      const id = p.id || p.shortDescription?.id;
      const detailUrl = id ? `https://${slug}.jobs.personio.de/job/${id}` : null;
      if (!detailUrl) continue;
      const desc = (p.jobDescriptions?.jobDescription || []).map((d) => `${d.name || ''}\n${d.value || ''}`).join('\n\n');
      out.push(createJob({
        source: 'personio',
        source_kind: 'ats',
        url: detailUrl,
        title: p.name,
        company: slug,
        location: [p.office, p.subcompany].filter(Boolean).join(', '),
        source_id: id,
        remote: /remote|home/i.test(`${p.name} ${p.office || ''}`),
        description: stripHtml(desc),
        description_html: desc,
        employment_type: p.employmentType ? String(p.employmentType).toUpperCase() : null,
        posted_at: p.createdAt,
        tags: [p.department, p.recruitingCategory].filter(Boolean),
        raw: p,
      }));
    }
  }
  return out;
}
