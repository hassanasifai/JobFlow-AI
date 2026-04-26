// scanners/api/remoteok.mjs — https://remoteok.com/api
//
// Single-endpoint dump (~99 latest tech-heavy worldwide remote jobs). No auth,
// requires a real-looking User-Agent (default UA in _base.mjs covers this).
// Filter by tags is client-side; user-provided tags are matched against j.tags.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'remoteok',
  kind: 'api',
  regions: ['worldwide-remote'],
  supports: { queries: true, tags: true, locations: false, countries: false },
  presets: {
    tags: [
      'engineer', 'senior', 'developer', 'react', 'node', 'python', 'javascript',
      'typescript', 'golang', 'rust', 'devops', 'aws', 'kubernetes', 'design',
      'product', 'marketing', 'sales', 'crypto', 'web3', 'ai', 'ml', 'data',
    ],
    queries: [],
  },
  schema: {
    queries: 'string[] // optional client-side keyword match against title/description',
    tags: 'string[]    // optional client-side match against tags array',
  },
  docs: 'https://remoteok.com/api',
};

const URL_API = 'https://remoteok.com/api';

export default async function fetchRemoteOk(config = {}, ctx) {
  const release = await ctx.rateLimiter.acquire(URL_API);
  let data;
  try {
    data = await fetchWithRetry(URL_API, { accept: 'json' });
  } finally { release(); }

  // Endpoint returns [legend, ...jobs]; first entry has no `id`.
  const jobs = (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.url);

  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const tags = (config.tags || []).map((t) => t.toLowerCase()).filter(Boolean);

  const out = [];
  for (const j of jobs) {
    const title = j.position || j.title || '';
    const desc = stripHtml(j.description || '');
    const blob = `${title} ${desc}`.toLowerCase();
    if (queries.length && !queries.some((q) => blob.includes(q))) continue;
    const jobTags = (j.tags || []).map((t) => String(t).toLowerCase());
    if (tags.length && !tags.some((t) => jobTags.includes(t))) continue;

    out.push(createJob({
      source: 'remoteok',
      source_kind: 'api',
      url: j.url || j.apply_url,
      title,
      company: j.company,
      location: j.location || 'Anywhere',
      remote: true,
      region: ['worldwide-remote'],
      description: desc,
      salary_min: j.salary_min ?? null,
      salary_max: j.salary_max ?? null,
      salary_currency: j.salary_min ? 'USD' : null,
      posted_at: j.date,
      tags: j.tags || [],
      raw: j,
    }));
  }
  return out;
}
