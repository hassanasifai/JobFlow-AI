// scanners/api/working-nomads.mjs — https://www.workingnomads.com/api/exposed_jobs/
//
// Public JSON dump (~700 active worldwide remote roles). No auth.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'working-nomads',
  kind: 'api',
  regions: ['worldwide-remote'],
  supports: { queries: true, categories: true, tags: true },
  presets: {
    categories: [
      'development', 'system-administration', 'design', 'business', 'marketing',
      'management', 'sales', 'project-management', 'writing', 'support', 'finance',
    ],
    tags: [],
    queries: [],
  },
  schema: {
    queries: 'string[]    // client-side keyword match',
    categories: 'string[] // client-side filter on category field',
    tags: 'string[]       // client-side filter on tags field',
  },
  docs: 'https://www.workingnomads.com/jobs',
};

const URL_API = 'https://www.workingnomads.com/api/exposed_jobs/';

export default async function fetchWorkingNomads(config = {}, ctx) {
  const release = await ctx.rateLimiter.acquire(URL_API);
  let data;
  try { data = await fetchWithRetry(URL_API, { accept: 'json' }); }
  finally { release(); }

  const jobs = Array.isArray(data) ? data : [];
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const cats = (config.categories || []).map((c) => c.toLowerCase()).filter(Boolean);
  const tags = (config.tags || []).map((t) => t.toLowerCase()).filter(Boolean);

  const out = [];
  for (const j of jobs) {
    const title = j.title || '';
    const desc = stripHtml(j.description || '');
    const blob = `${title} ${desc}`.toLowerCase();
    if (queries.length && !queries.some((q) => blob.includes(q))) continue;

    const cat = String(j.category || '').toLowerCase();
    if (cats.length && !cats.some((c) => cat.includes(c))) continue;

    const jobTags = String(j.tags || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length && !tags.some((t) => jobTags.includes(t))) continue;

    out.push(createJob({
      source: 'working-nomads',
      source_kind: 'api',
      url: j.url,
      title,
      company: j.company_name,
      location: j.location || j.region || 'Anywhere',
      remote: true,
      region: ['worldwide-remote'],
      description: desc,
      posted_at: j.pub_date,
      tags: jobTags,
      raw: j,
    }));
  }
  return out;
}
