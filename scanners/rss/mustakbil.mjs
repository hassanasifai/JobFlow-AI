// scanners/rss/mustakbil.mjs — https://rss.mustakbil.com/jobs-rss
//
// Pakistan's cleanest free job feed. Returns RSS 2.0 with structured
// title/company/city/country/category and content:encoded.

import { fetchWithRetry, parseRss, createJob, stripHtml, xmlText } from '../_base.mjs';

export const meta = {
  id: 'mustakbil',
  kind: 'rss',
  regions: ['pakistan'],
  supports: { categories: true, queries: true, locations: true },
  presets: {
    // Mustakbil category codes (selectable). Free-text codes are also accepted.
    categories: [
      'all', 'IT', 'Engineering', 'Sales-Marketing', 'Banking-Finance',
      'Accounts', 'Customer-Service', 'Health-Care', 'Education', 'HR',
      'Telecom', 'Media-Communication', 'Logistics', 'Manufacturing',
    ],
    locations: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Peshawar', 'Multan', 'Faisalabad', 'Quetta', 'Sialkot'],
    queries: [],
  },
  schema: {
    categories: 'string[]  passes to ?c= (use "all" or omit for master feed)',
    queries: 'string[]     client-side keyword match',
    locations: 'string[]   client-side city filter (matched against item city)',
  },
  docs: 'https://www.mustakbil.com/jobs-rss',
};

const BASE = 'https://rss.mustakbil.com/jobs-rss';

export default async function fetchMustakbil(config = {}, ctx) {
  const cats = config.categories?.length ? config.categories : ['all'];
  const queries = (config.queries || []).map((q) => q.toLowerCase()).filter(Boolean);
  const locs = (config.locations || []).map((l) => l.toLowerCase()).filter(Boolean);

  const out = [];
  const seen = new Set();

  for (const cat of cats) {
    const url = cat && cat !== 'all' ? `${BASE}?c=${encodeURIComponent(cat)}` : BASE;
    const release = await ctx.rateLimiter.acquire(url);
    let xml;
    try { xml = await fetchWithRetry(url, { accept: 'text' }); }
    catch (err) { ctx.log('warn', `mustakbil ${cat} failed: ${err.message}`); release(); continue; }
    finally { release(); }

    const items = parseRss(xml);
    for (const it of items) {
      if (!it.link || seen.has(it.link)) continue;
      seen.add(it.link);
      const r = it.raw || {};

      // Mustakbil RSS uses CDATA wrappers for these custom fields.
      const company = xmlText(r.company).trim();
      const city = xmlText(r.city).trim();
      const country = xmlText(r.country).trim() || 'Pakistan';
      const desc = stripHtml(it.description || '');
      const blob = `${it.title} ${company} ${desc}`.toLowerCase();
      if (queries.length && !queries.some((q) => blob.includes(q))) continue;
      if (locs.length && !locs.some((l) => city.toLowerCase().includes(l))) continue;

      out.push(createJob({
        source: 'mustakbil',
        source_kind: 'rss',
        url: it.link,
        title: it.title,
        company,
        location: [city, country].filter(Boolean).join(', '),
        country,
        region: ['pakistan'],
        description: desc,
        posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        tags: it.category || [],
        raw: r,
      }));
    }
  }
  return out;
}
