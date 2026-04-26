// scanners/ats/teamtailor.mjs — https://career.{slug}.com/jobs.json or {slug}.teamtailor.com/jobs.json
//
// Two endpoint shapes are common:
//   1. https://{slug}.teamtailor.com/jobs.json
//   2. https://career.{slug}.com/jobs.json (custom careers domain)
//
// Adapter accepts either: pass `companies` as either Teamtailor slugs OR full
// careers-domain hosts. We try both shapes per entry.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'teamtailor',
  kind: 'ats',
  regions: ['worldwide', 'europe'],
  supports: { companies: true },
  presets: { companies: [] },
  schema: { companies: 'string[]  slug or full host (e.g. "acme" or "career.acme.com")' },
  docs: 'https://www.teamtailor.com/',
  requiresInputs: ['companies'],
};

export default async function fetchTeamtailor(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  const out = [];
  for (const entry of companies) {
    const candidates = entry.includes('.')
      ? [`https://${entry}/jobs.json`]
      : [`https://${entry}.teamtailor.com/jobs.json`, `https://career.${entry}.com/jobs.json`];

    let data, hostUsed;
    for (const url of candidates) {
      const release = await ctx.rateLimiter.acquire(url);
      try {
        data = await fetchWithRetry(url, { accept: 'json', retries: 0 });
        hostUsed = url;
        break;
      } catch { /* try next */ }
      finally { release(); }
    }
    if (!data) { ctx.log('warn', `teamtailor ${entry}: no shape worked`); continue; }

    const jobs = data?.data || data?.jobs || [];
    for (const j of jobs) {
      const attr = j.attributes || j;
      const link = attr.url || attr['careersite-job-url'] || attr.shortlink || hostUsed;
      out.push(createJob({
        source: 'teamtailor',
        source_kind: 'ats',
        url: link,
        title: attr.title || attr.name,
        company: entry,
        location: [attr['locations-string'], attr.location, attr.region].filter(Boolean).join(', '),
        remote: !!attr.remote || /remote/i.test(attr['locations-string'] || ''),
        description: stripHtml(attr.body || attr.description || ''),
        employment_type: attr['employment-type'] ? String(attr['employment-type']).toUpperCase() : null,
        posted_at: attr['created-at'] || attr.created_at,
        tags: attr.tags || [],
        raw: j,
      }));
    }
  }
  return out;
}
