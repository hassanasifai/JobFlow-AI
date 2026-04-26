// scanners/api/themuse.mjs — https://www.themuse.com/api/public/jobs
//
// Public API. Free key (https://www.themuse.com/developers) raises rate limit
// from 500/h to 3,600/h. Works without a key for low-volume use.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'themuse',
  kind: 'api',
  regions: ['worldwide', 'worldwide-remote', 'gulf'],
  supports: { queries: true, categories: true, levels: true, locations: true, max_pages: true },
  presets: {
    categories: [
      'Engineering', 'Data Science', 'Design & UX', 'Product Management',
      'Marketing', 'Sales', 'Customer Service', 'Operations', 'Finance',
      'HR & Recruiting', 'Software Engineering', 'Project Management',
    ],
    levels: ['Internship', 'Entry Level', 'Mid Level', 'Senior Level', 'Management'],
    locations: [
      'Flexible / Remote', 'Dubai, United Arab Emirates', 'Abu Dhabi, United Arab Emirates',
      'Riyadh, Saudi Arabia', 'Doha, Qatar', 'Cairo, Egypt', 'Karachi, Pakistan',
      'Lahore, Pakistan', 'Islamabad, Pakistan',
    ],
    queries: [],
  },
  schema: {
    api_key: 'string?     // optional; raises rate limit',
    queries: 'string[]    // client-side keyword match',
    categories: 'string[] // server-side ?category=',
    levels: 'string[]     // server-side ?level=',
    locations: 'string[]  // server-side ?location=',
    max_pages: 'number    // default 5',
  },
  docs: 'https://www.themuse.com/developers/api/v2',
  requiresKey: false,
  signupUrl: 'https://www.themuse.com/developers/api/v2',
  freeTier: 'Works without key (lower rate); free key raises 500 → 3,600 req/h',
};

const BASE = 'https://www.themuse.com/api/public/jobs';

export default async function fetchThemuse(config = {}, ctx) {
  const apiKey = config.api_key || process.env.THE_MUSE_KEY || null;
  const maxPages = config.max_pages ?? 5;
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const cats = config.categories?.length ? config.categories : [''];
  const levels = config.levels?.length ? config.levels : [''];
  const locations = config.locations?.length ? config.locations : [''];

  const out = [];
  const seen = new Set();

  for (const c of cats) {
    for (const lvl of levels) {
      for (const loc of locations) {
        for (let page = 0; page < maxPages; page++) {
          const params = new URLSearchParams();
          params.set('page', String(page));
          if (c) params.append('category', c);
          if (lvl) params.append('level', lvl);
          if (loc) params.append('location', loc);
          if (apiKey) params.set('api_key', apiKey);
          const url = `${BASE}?${params}`;

          const release = await ctx.rateLimiter.acquire(url);
          let data;
          try { data = await fetchWithRetry(url, { accept: 'json' }); }
          finally { release(); }

          const jobs = data?.results || [];
          if (jobs.length === 0) break;

          for (const j of jobs) {
            if (!j.refs?.landing_page || seen.has(j.refs.landing_page)) continue;
            seen.add(j.refs.landing_page);
            const title = j.name || '';
            const desc = stripHtml(j.contents || '');
            const blob = `${title} ${desc}`.toLowerCase();
            if (queries.length && !queries.some((q) => blob.includes(q))) continue;

            const locStr = (j.locations || []).map((l) => l.name).join(', ');
            const remote = /flexible|remote/i.test(locStr);
            out.push(createJob({
              source: 'themuse',
              source_kind: 'api',
              url: j.refs.landing_page,
              title,
              company: j.company?.name || '',
              location: locStr,
              remote,
              region: remote ? ['worldwide-remote'] : [],
              description: desc,
              employment_type: j.type ? String(j.type).toUpperCase().replace(' ', '_') : null,
              posted_at: j.publication_date,
              tags: [].concat(j.categories || [], j.levels || []).map((x) => x.name || x),
              raw: j,
            }));
          }
          if ((data?.page_count || 0) <= page + 1) break;
        }
      }
    }
  }
  return out;
}
