// scanners/api/hn-whoishiring.mjs — Hacker News "Who is hiring?" via Algolia
//
// Each month's "Ask HN: Who is hiring?" thread is a high-signal source. We
// search the most-recent thread (auto-discovered) and extract comments matching
// user-supplied queries (e.g. "remote", "rust", "Pakistan").
//
// Algolia public API: 10,000 req/h per IP. No auth.

import { fetchWithRetry, createJob, stripHtml, slugify } from '../_base.mjs';

export const meta = {
  id: 'hn-whoishiring',
  kind: 'api',
  regions: ['worldwide-remote', 'worldwide'],
  supports: { queries: true, max_threads: true, hits_per_page: true },
  presets: {
    // Suggestions only — UI may show as chips. Empty config = no search.
    queries: [],
  },
  schema: {
    queries: 'string[]      // each is searched within the latest thread',
    max_threads: 'number    // how many recent monthly threads to scan; default 1',
    hits_per_page: 'number  // default 100, max 1000',
  },
  docs: 'https://hn.algolia.com/api',
};

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

export default async function fetchHnWhoIsHiring(config = {}, ctx) {
  // Algolia requires at least one query token; the user must provide one.
  // We do NOT default to "remote" — that silently scopes results without consent.
  const queries = (config.queries || []).filter(Boolean);
  if (queries.length === 0) {
    ctx.log('warn', 'hn-whoishiring: no queries provided; skipping (pass at least one keyword)');
    return [];
  }
  const maxThreads = config.max_threads ?? 1;
  const hitsPerPage = Math.min(config.hits_per_page ?? 100, 1000);

  // Find the latest "Ask HN: Who is hiring?" stories.
  const findUrl = `${ALGOLIA_BASE}/search?tags=story,author_whoishiring&hitsPerPage=${maxThreads + 2}`;
  const release1 = await ctx.rateLimiter.acquire(findUrl);
  let stories;
  try { stories = await fetchWithRetry(findUrl, { accept: 'json' }); }
  finally { release1(); }

  const threadIds = (stories?.hits || [])
    .filter((h) => /who\s*is\s*hiring/i.test(h.title || ''))
    .slice(0, maxThreads)
    .map((h) => h.objectID);

  if (threadIds.length === 0) return [];

  const out = [];
  const seen = new Set();

  for (const threadId of threadIds) {
    for (const q of queries) {
      const url = `${ALGOLIA_BASE}/search?tags=comment,story_${threadId}&query=${encodeURIComponent(q)}&hitsPerPage=${hitsPerPage}`;
      const release = await ctx.rateLimiter.acquire(url);
      let data;
      try { data = await fetchWithRetry(url, { accept: 'json' }); }
      finally { release(); }

      for (const h of (data?.hits || [])) {
        const text = stripHtml(h.comment_text || '');
        if (!text || text.length < 60) continue;
        const id = `https://news.ycombinator.com/item?id=${h.objectID}`;
        if (seen.has(id)) continue;
        seen.add(id);

        // Extract a likely title (first line) and company (initial bold or "|" prefix)
        const firstLine = text.split('\n')[0].slice(0, 200);
        const companyMatch = firstLine.match(/^([A-Z][A-Za-z0-9 .&-]{1,50})(?:\s*\||\s*[—-])/);
        const company = companyMatch ? companyMatch[1].trim() : `HN ${threadId}`;
        const title = firstLine.replace(company, '').replace(/^[\s|—-]+/, '').slice(0, 140) || firstLine;

        out.push(createJob({
          source: 'hn-whoishiring',
          source_kind: 'api',
          url: id,
          title,
          company,
          location: '',
          description: text,
          posted_at: h.created_at,
          tags: ['hn'],
          raw: { ...h, threadId, query: q },
        }));
      }
    }
  }
  // Slug-normalize companies so dedup downstream is happy
  return out.map((j) => ({ ...j, company: j.company || `hn-${slugify(j.title).slice(0, 20)}` }));
}
