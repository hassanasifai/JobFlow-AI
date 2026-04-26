// scanners/rss/python-jobs.mjs — https://www.python.org/jobs/feed/rss/
//
// The PSF's official Python jobs board. RSS, no auth, ~20 fresh items.
// Niche but every posting is high-signal — mostly senior+ Python roles
// across the world.

import { fetchWithRetry, parseRss, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'python-jobs',
  kind: 'rss',
  regions: ['worldwide-remote', 'worldwide'],
  supports: { queries: true },
  presets: { queries: [] },
  schema: {
    queries: 'string[]   client-side keyword match against title + description',
  },
  docs: 'https://www.python.org/jobs/feed/rss/',
};

const FEED = 'https://www.python.org/jobs/feed/rss/';

export default async function fetchPythonJobs(config = {}, ctx) {
  const release = await ctx.rateLimiter.acquire(FEED);
  let xml;
  try { xml = await fetchWithRetry(FEED, { accept: 'text' }); }
  finally { release(); }

  const items = parseRss(xml);
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const out = [];

  for (const it of items) {
    if (!it.link || !it.title) continue;
    const desc = stripHtml(it.description || '');
    const blob = `${it.title} ${desc}`.toLowerCase();
    if (queries.length && !queries.some((q) => blob.includes(q))) continue;
    // Title format: "Senior Backend Engineer (Remote) at Acme"
    const m = it.title.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    const role = m ? m[1].trim() : it.title;
    const company = m ? m[2].trim() : 'Unknown';
    const remote = /remote|anywhere|worldwide|distributed/i.test(it.title) || /remote/i.test(desc);

    out.push(createJob({
      source: 'python-jobs',
      source_kind: 'rss',
      url: it.link,
      title: role,
      company,
      location: remote ? 'Remote' : '',
      remote,
      region: remote ? ['worldwide-remote'] : [],
      description: desc,
      posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
      tags: [].concat(it.category || []).filter(Boolean),
      raw: it.raw,
    }));
  }
  return out;
}
