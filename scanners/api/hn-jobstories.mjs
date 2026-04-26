// scanners/api/hn-jobstories.mjs — Hacker News /jobstories.json
//
// Every job posting submitted to HN as type=job. Distinct from "Who Is Hiring"
// (which we already have via Algolia): jobstories.json surfaces YC-funded
// startup roles posted directly as HN stories. Roughly 30 fresh entries at
// any given time, refreshed continuously.
//
// Endpoint shape:
//   GET /v0/jobstories.json     → [id1, id2, …]
//   GET /v0/item/{id}.json      → { id, title, url, by, time, type:'job' }
//
// No auth, free, no rate limit beyond Firebase's generous defaults.
// Per-id fetches run with the existing rate limiter (1.5 s/host).

import { fetchWithRetry, createJob } from '../_base.mjs';

export const meta = {
  id: 'hn-jobstories',
  kind: 'api',
  regions: ['worldwide-remote', 'worldwide'],
  supports: { queries: true, max_items: true },
  presets: { queries: [] },
  schema: {
    queries: 'string[]   client-side keyword match against title',
    max_items: 'number   default 30 (HN typically has ~30 active job stories)',
  },
  docs: 'https://github.com/HackerNews/API#new-top-and-best-stories',
};

const STORIES_URL = 'https://hacker-news.firebaseio.com/v0/jobstories.json';
const ITEM_URL = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

export default async function fetchHnJobStories(config = {}, ctx) {
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const maxItems = Math.max(1, Math.min(100, Number(config.max_items) || 30));

  // 1. Fetch the id list (cheap — single GET, ~280 bytes).
  const release = await ctx.rateLimiter.acquire(STORIES_URL);
  let ids;
  try { ids = await fetchWithRetry(STORIES_URL, { accept: 'json' }); }
  finally { release(); }
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // 2. Per-id detail. We deliberately don't parallelize past concurrency=4
  //    to stay polite to Firebase even though their docs allow more.
  const out = [];
  for (const id of ids.slice(0, maxItems)) {
    if (out.length >= maxItems) break;
    const url = ITEM_URL(id);
    const r = await ctx.rateLimiter.acquire(url);
    let item;
    try { item = await fetchWithRetry(url, { accept: 'json', timeoutMs: 6000, retries: 1 }); }
    catch (err) { ctx.log('warn', `hn-jobstories item ${id}: ${err.message}`); r(); continue; }
    finally { r(); }
    if (!item || item.type !== 'job' || !item.title) continue;

    // Title format on HN job stories is typically:
    //   "Company Name (YC SXX) Hiring: Role Title — extras"
    // We split into company / title to match the rest of the system.
    const { company, title } = parseHnJobTitle(item.title);
    if (!title) continue;
    if (queries.length && !queries.some((q) => `${item.title}`.toLowerCase().includes(q))) continue;

    out.push(createJob({
      source: 'hn-jobstories',
      source_kind: 'api',
      source_id: String(id),
      url: item.url || `https://news.ycombinator.com/item?id=${id}`,
      title,
      company: company || `HN #${id}`,
      location: 'Remote',
      remote: true,
      region: ['worldwide-remote'],
      posted_at: item.time ? new Date(item.time * 1000).toISOString() : null,
      tags: ['hn', 'yc'],
      raw: item,
    }));
  }
  return out;
}

/**
 * Tease apart "Company (YC X25) Hiring: Senior Backend Engineer (Remote)"
 * into company + title. The "(YC …) Hiring:" infix is the canonical anchor.
 * Falls back to splitting on the first " - " or " — " when it's missing.
 */
function parseHnJobTitle(raw) {
  if (!raw) return { company: '', title: '' };
  let s = String(raw).trim();
  const ycMatch = s.match(/^(.+?)\s*\(YC[^)]*\)\s*[Hh]iring:?\s*(.+)$/);
  if (ycMatch) return { company: ycMatch[1].trim(), title: ycMatch[2].trim() };
  const hiringMatch = s.match(/^(.+?)\s+[Ii]s\s+[Hh]iring(?:\s+a)?:?\s*(.+)$/);
  if (hiringMatch) return { company: hiringMatch[1].trim(), title: hiringMatch[2].trim() };
  const dashMatch = s.match(/^(.+?)\s+[—-]\s+(.+)$/);
  if (dashMatch) return { company: dashMatch[1].trim(), title: dashMatch[2].trim() };
  return { company: '', title: s };
}
