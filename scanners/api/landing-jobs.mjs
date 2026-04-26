// scanners/api/landing-jobs.mjs — https://landing.jobs/api/v1/jobs
//
// Lisbon-based job board, EU-heavy with strong remote coverage. Their
// public JSON API exposes title, company, salary range (with currency),
// remote flag, and required skills. No auth.
//
// Verified alive January 2026: 200 OK, ~300 KB JSON for default page.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'landing-jobs',
  kind: 'api',
  regions: ['worldwide-remote', 'europe', 'portugal'],
  supports: { queries: true, max_pages: true, remote_only: true },
  presets: {
    queries: [],
    technologies: ['javascript', 'typescript', 'react', 'node', 'python', 'go', 'rust', 'kubernetes'],
  },
  schema: {
    queries: 'string[]      client-side keyword match',
    technologies: 'string[]  filter by tech stack tag',
    max_pages: 'number       default 3 (×30 = 90 jobs)',
    remote_only: 'boolean   default false; true → only fully-remote postings',
  },
  docs: 'https://landing.jobs/api/v1/jobs',
};

const BASE = 'https://landing.jobs/api/v1/jobs';

export default async function fetchLandingJobs(config = {}, ctx) {
  const queries = (config.queries || []).map((q) => String(q).toLowerCase()).filter(Boolean);
  const techs = (config.technologies || []).map((t) => String(t).toLowerCase());
  const maxPages = Math.max(1, Math.min(10, Number(config.max_pages) || 3));
  const remoteOnly = config.remote_only === true;

  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}?page=${page}`;
    const release = await ctx.rateLimiter.acquire(url);
    let data;
    try { data = await fetchWithRetry(url, { accept: 'json' }); }
    catch (err) { ctx.log('warn', `landing-jobs p${page}: ${err.message}`); release(); break; }
    finally { release(); }

    const items = Array.isArray(data) ? data : (Array.isArray(data?.jobs) ? data.jobs : []);
    if (items.length === 0) break;

    for (const j of items) {
      const link = j.url || j.link || j.canonical_url;
      if (!link || seen.has(link)) continue;
      seen.add(link);
      const title = j.title || j.role;
      if (!title) continue;
      const remote = j.remote === true || /remote|anywhere|worldwide/i.test(j.location || '');
      if (remoteOnly && !remote) continue;
      const titleBlob = `${title} ${(j.tags || j.technologies || []).join(' ')}`.toLowerCase();
      if (queries.length && !queries.some((q) => titleBlob.includes(q))) continue;
      const tags = (j.technologies || j.tags || []).map((t) => typeof t === 'string' ? t : t?.name).filter(Boolean);
      if (techs.length && !techs.some((t) => tags.map(String).map((x) => x.toLowerCase()).includes(t))) continue;

      out.push(createJob({
        source: 'landing-jobs',
        source_kind: 'api',
        source_id: String(j.id || link),
        url: link,
        title,
        company: j.company?.name || j.company_name || j.company || 'Unknown',
        location: j.location || (remote ? 'Remote' : ''),
        remote,
        region: remote ? ['worldwide-remote'] : [],
        description: stripHtml(j.description || j.summary || ''),
        salary_min: j.salary_min ?? null,
        salary_max: j.salary_max ?? null,
        salary_currency: j.salary_currency || j.currency || null,
        employment_type: j.contract_type ? String(j.contract_type).toUpperCase().replace(/-/g, '_') : null,
        posted_at: j.published_at || j.created_at || null,
        expires_at: j.expires_at || null,
        tags,
        raw: j,
      }));
    }
    if (items.length < 30) break;            // last page
  }
  return out;
}
