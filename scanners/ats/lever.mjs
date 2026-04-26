// scanners/ats/lever.mjs — https://api.lever.co/v0/postings/{company}?mode=json
//
// No auth. {company} is the company's Lever slug.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'lever',
  kind: 'ats',
  regions: ['worldwide'],
  supports: { companies: true },
  presets: {
    companies: ['netflix', 'shopify', 'palantir', 'mistralai', 'spotify'],
  },
  schema: { companies: 'string[]   list of Lever slugs' },
  docs: 'https://github.com/lever/postings-api',
  requiresInputs: ['companies'],
};

export default async function fetchLever(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  const out = [];
  for (const slug of companies) {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
    const release = await ctx.rateLimiter.acquire(url);
    let data;
    try { data = await fetchWithRetry(url, { accept: 'json' }); }
    catch (err) { ctx.log('warn', `lever ${slug}: ${err.message}`); release(); continue; }
    finally { release(); }

    if (!Array.isArray(data)) continue;
    for (const j of data) {
      const cat = j.categories || {};
      const desc = stripHtml(`${j.descriptionPlain || j.description || ''} ${(j.lists || []).map((l) => l.text).join(' ')}`);
      out.push(createJob({
        source: 'lever',
        source_kind: 'ats',
        url: j.hostedUrl || j.applyUrl,
        title: j.text,
        company: slug,
        location: cat.location || cat.allLocations?.join(', ') || '',
        remote: /remote/i.test(cat.location || ''),
        description: desc,
        employment_type: cat.commitment ? String(cat.commitment).toUpperCase() : null,
        posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        tags: [cat.team, cat.department].filter(Boolean),
        raw: j,
      }));
    }
  }
  return out;
}
