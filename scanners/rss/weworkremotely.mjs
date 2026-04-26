// scanners/rss/weworkremotely.mjs — https://weworkremotely.com/categories/{slug}.rss
//
// 10 categories. User can pass any slug (the site occasionally adds new ones —
// free-text input is supported).

import { fetchWithRetry, parseRss, createJob, stripHtml, slugify } from '../_base.mjs';

export const meta = {
  id: 'weworkremotely',
  kind: 'rss',
  regions: ['worldwide-remote'],
  supports: { categories: true, queries: true },
  presets: {
    categories: [
      'remote-programming-jobs',
      'remote-back-end-programming-jobs',
      'remote-full-stack-programming-jobs',
      'remote-front-end-programming-jobs',
      'remote-devops-sysadmin-jobs',
      'remote-sales-and-marketing-jobs',
      'remote-management-and-finance-jobs',
      'remote-product-jobs',
      'remote-customer-support-jobs',
      'remote-design-jobs',
      'all-other-remote-jobs',
    ],
    queries: [],
  },
  schema: {
    categories: 'string[]   slugs to fetch; default = all presets',
    queries: 'string[]      client-side keyword match',
  },
  docs: 'https://weworkremotely.com/categories',
};

const BASE = 'https://weworkremotely.com/categories';

export default async function fetchWeWorkRemotely(config = {}, ctx) {
  const cats = (config.categories?.length ? config.categories : meta.presets.categories);
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);

  const out = [];
  const seen = new Set();

  for (const cat of cats) {
    const url = `${BASE}/${cat}.rss`;
    const release = await ctx.rateLimiter.acquire(url);
    let xml;
    try { xml = await fetchWithRetry(url, { accept: 'text' }); }
    catch (err) { ctx.log('warn', `wwr ${cat} failed: ${err.message}`); release(); continue; }
    finally { release(); }

    const items = parseRss(xml);
    for (const it of items) {
      if (!it.link || seen.has(it.link)) continue;
      seen.add(it.link);

      const desc = stripHtml(it.description || '');
      const blob = `${it.title} ${desc}`.toLowerCase();
      if (queries.length && !queries.some((q) => blob.includes(q))) continue;

      // WWR titles are typically "Company: Job title"
      const split = it.title.split(/[:\u2014—-]/);
      const company = split.length > 1 ? split[0].trim() : '';
      const title = split.length > 1 ? split.slice(1).join('-').trim() : it.title;

      out.push(createJob({
        source: 'weworkremotely',
        source_kind: 'rss',
        url: it.link,
        title,
        company: company || `wwr-${slugify(cat)}`,
        location: 'Anywhere',
        remote: true,
        region: ['worldwide-remote'],
        description: desc,
        posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        tags: [cat],
        raw: it.raw,
      }));
    }
  }
  return out;
}
