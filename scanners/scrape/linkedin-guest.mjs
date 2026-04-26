// scanners/scrape/linkedin-guest.mjs
//
// LinkedIn jobs-guest endpoint — works without authentication BUT LinkedIn's
// ToS prohibits automated scraping. This adapter is provided for completeness
// and is OFF by default. Operators must set `acknowledge_tos_risk: true` to
// enable it. Use proxies + low cadence; LinkedIn returns 429 fast.
//
// Endpoint pattern:
//   https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
//     ?keywords=&location=&start={N}&f_TPR={time_range}
//
// f_TPR values: r3600 (last hour), r86400 (24h), r604800 (week), r2592000 (month)

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'linkedin-guest',
  kind: 'scrape',
  regions: ['worldwide', 'pakistan', 'gulf', 'uae', 'saudi-arabia'],
  supports: { queries: true, locations: true, max_pages: true, time_range: true },
  presets: {
    locations: [
      'Pakistan', 'United Arab Emirates', 'Dubai', 'Abu Dhabi',
      'Saudi Arabia', 'Riyadh', 'Qatar', 'Doha', 'Worldwide',
    ],
    time_range: ['r3600', 'r86400', 'r604800', 'r2592000'],
    queries: [],
  },
  schema: {
    acknowledge_tos_risk: 'boolean  REQUIRED — must be true to run',
    queries: 'string[]   keywords parameter',
    locations: 'string[] location parameter',
    max_pages: 'number   default 5 (×25 = 125 results)',
    time_range: 'string  default r604800 (last 7 days)',
  },
  docs: 'https://www.linkedin.com/jobs/search/',
  warning: 'LinkedIn ToS prohibits automated access. Enable only if you accept the risk.',
  requiresAck: 'acknowledge_tos_risk',
};

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

export default async function fetchLinkedinGuest(config = {}, ctx) {
  if (config.acknowledge_tos_risk !== true) {
    ctx.log('warn', 'linkedin-guest: acknowledge_tos_risk not set; skipping');
    return [];
  }
  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const maxPages = config.max_pages ?? 5;
  const timeRange = config.time_range || 'r604800';

  const out = [];
  const seen = new Set();

  for (const q of queries) {
    for (const loc of locations) {
      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
          keywords: q,
          location: loc,
          start: String(page * 25),
          f_TPR: timeRange,
        });
        const url = `${BASE}?${params}`;
        const release = await ctx.rateLimiter.acquire(url);
        let html;
        try { html = await fetchWithRetry(url, { accept: 'text', timeoutMs: 12_000, retries: 1 }); }
        catch (err) { ctx.log('warn', `linkedin ${q}/${loc} p${page}: ${err.message}`); release(); break; }
        finally { release(); }

        const cards = extractCards(html);
        if (cards.length === 0) break;
        for (const c of cards) {
          if (seen.has(c.url)) continue;
          seen.add(c.url);
          out.push(createJob({
            source: 'linkedin-guest',
            source_kind: 'scrape',
            url: c.url,
            title: c.title,
            company: c.company,
            location: c.location,
            // The guest endpoint is reached only with an explicit `location`
            // filter; we leave remote inference to createJob() which checks
            // the title/location text rather than assuming.
            posted_at: c.posted,
            raw: c,
          }));
        }
      }
    }
  }
  return out;
}

// Minimal regex-based extraction over the (server-rendered) card HTML.
function extractCards(html) {
  const out = [];
  const cardRegex = /<li[\s\S]*?<\/li>/g;
  for (const block of html.match(cardRegex) || []) {
    const url = (block.match(/href=["']([^"']*\/jobs\/view\/[^"']+)["']/) || [])[1];
    if (!url) continue;
    const title = stripHtml((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
    const company = stripHtml((block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1] || '');
    const location = stripHtml((block.match(/job-search-card__location["'][^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    const posted = (block.match(/datetime=["']([^"']+)["']/) || [])[1] || null;
    if (title && url) out.push({ title, company, location, url: url.split('?')[0], posted });
  }
  return out;
}
