// scanners/jsonld/universal.mjs — universal long-tail scraper
//
// Strategy (Google-for-Jobs-friendly): given a list of URLs (sitemap roots,
// careers index pages, RSS feeds, or arbitrary detail URLs), discover detail
// pages and extract <script type="application/ld+json"> JobPosting blocks.
// Covers hundreds of small boards that don't have an API but emit Google JSON-LD.
//
// Discovery rules per `urls[]` entry:
//   - ends with /sitemap.xml or /sitemap_index.xml → parse sitemap, follow leaves
//   - ends with .rss / .xml / .atom + RSS contents → use <link> per item
//   - otherwise → treat as a detail page directly

import {
  fetchWithRetry, parseSitemap, parseRss, extractJsonLdBlocks,
  findJobPostings, jobPostingToPartial, createJob, isAllowedByRobots,
} from '../_base.mjs';

export const meta = {
  id: 'universal',
  kind: 'jsonld',
  regions: ['worldwide'],
  supports: { urls: true, queries: true, max_urls: true, regions: true, robots_strict: true },
  presets: { urls: [], queries: [] },
  schema: {
    urls: 'string[]      sitemaps, RSS feeds, or detail URLs to crawl',
    queries: 'string[]   client-side keyword match',
    max_urls: 'number    cap on detail-page fetches per entry, default 200',
    regions: 'string[]   region tags to apply to all jobs from this run',
    robots_strict: 'boolean  default true — skip URLs disallowed by robots.txt',
  },
  docs: 'https://schema.org/JobPosting',
  requiresInputs: ['urls'],
};

export default async function fetchUniversal(config = {}, ctx) {
  const sources = (config.urls || []).filter(Boolean);
  if (sources.length === 0) return [];
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const maxUrls = config.max_urls ?? 200;
  const regions = config.regions || [];
  const strictRobots = config.robots_strict !== false;

  const out = [];
  const seen = new Set();

  for (const entry of sources) {
    const detailUrls = await discover(entry, maxUrls, ctx);
    let processed = 0;
    for (const url of detailUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (!await isAllowedByRobots(url, { strict: strictRobots })) continue;

      const release = await ctx.rateLimiter.acquire(url);
      let html;
      try { html = await fetchWithRetry(url, { accept: 'text' }); }
      catch (err) { ctx.log('warn', `universal ${url}: ${err.message}`); release(); continue; }
      finally { release(); }

      const postings = findJobPostings(extractJsonLdBlocks(html));
      for (const jp of postings) {
        const partial = jobPostingToPartial(jp, { source: 'universal', source_kind: 'jsonld' });
        if (!partial.url) partial.url = url;
        const blob = `${partial.title} ${partial.description || ''}`.toLowerCase();
        if (queries.length && !queries.some((q) => blob.includes(q))) continue;
        out.push(createJob({ ...partial, region: regions }));
      }
      if (++processed >= maxUrls) break;
    }
  }
  return out;
}

async function discover(entry, maxUrls, ctx) {
  const lower = entry.toLowerCase();
  if (lower.endsWith('.xml') || lower.includes('sitemap')) {
    const r = await ctx.rateLimiter.acquire(entry);
    try {
      const x = await fetchWithRetry(entry, { accept: 'text' });
      const items = parseSitemap(x);
      // Follow one level of sub-sitemaps if it's an index
      const out = [];
      for (const it of items) {
        if (it.sub) {
          try {
            const r2 = await ctx.rateLimiter.acquire(it.loc);
            try {
              const x2 = await fetchWithRetry(it.loc, { accept: 'text' });
              for (const u of parseSitemap(x2)) out.push(u.loc);
            } finally { r2(); }
          } catch { /* ignore */ }
        } else {
          out.push(it.loc);
        }
        if (out.length >= maxUrls * 2) break;
      }
      return out.slice(0, maxUrls);
    } catch { return []; }
    finally { r(); }
  }
  if (lower.endsWith('.rss') || lower.endsWith('.atom') || lower.includes('/feed')) {
    const r = await ctx.rateLimiter.acquire(entry);
    try {
      const x = await fetchWithRetry(entry, { accept: 'text' });
      return parseRss(x).map((it) => it.link).filter(Boolean).slice(0, maxUrls);
    } catch { return []; }
    finally { r(); }
  }
  // Otherwise treat as a single detail URL.
  return [entry];
}
