// scanners/api/adzuna.mjs — https://developer.adzuna.com
//
// Free aggregator API. Twelve country codes: gb, us, de, fr, au, nz, ca, in,
// pl, br, at, za. PK + Gulf are NOT supported by Adzuna — use this adapter for
// worldwide-remote and Tier-1 markets only.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'adzuna',
  kind: 'api',
  regions: ['worldwide-remote', 'usa', 'uk', 'germany', 'france', 'india', 'canada', 'australia', 'brazil', 'austria', 'south-africa', 'poland'],
  supports: { queries: true, locations: true, countries: true, max_pages: true, salary_min: true },
  presets: {
    countries: ['gb', 'us', 'de', 'fr', 'au', 'nz', 'ca', 'in', 'pl', 'br', 'at', 'za'],
    queries: [],
    locations: [],
  },
  schema: {
    app_id: 'string  REQUIRED — developer.adzuna.com',
    app_key: 'string REQUIRED',
    queries: 'string[]   `what` parameter',
    locations: 'string[] `where` parameter (city/postcode)',
    countries: 'string[] one search per country code',
    max_pages: 'number  default 3 (×50 = 150 results per query)',
    salary_min: 'number? optional minimum salary filter',
    full_time: 'boolean? optional',
  },
  docs: 'https://developer.adzuna.com/overview',
  requiresKey: true,
  envKeys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  signupUrl: 'https://developer.adzuna.com/signup',
  freeTier: '1,000 req / month · 25 req / min · global incl. PK + UAE',
};

const RESULTS_PER_PAGE = 50;

export default async function fetchAdzuna(config = {}, ctx) {
  const appId = config.app_id || process.env.ADZUNA_APP_ID;
  const appKey = config.app_key || process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) { ctx.log('warn', 'adzuna: app_id/app_key missing; skipping'); return []; }

  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const countries = config.countries?.length ? config.countries : ['gb'];
  const maxPages = config.max_pages ?? 3;

  const out = [];
  const seen = new Set();

  for (const cc of countries) {
    for (const q of queries) {
      for (const loc of locations) {
        for (let page = 1; page <= maxPages; page++) {
          const params = new URLSearchParams({
            app_id: appId,
            app_key: appKey,
            results_per_page: String(RESULTS_PER_PAGE),
          });
          if (q) params.set('what', q);
          if (loc) params.set('where', loc);
          if (config.salary_min) params.set('salary_min', String(config.salary_min));
          if (config.full_time) params.set('full_time', '1');
          const url = `https://api.adzuna.com/v1/api/jobs/${cc}/search/${page}?${params}`;

          const release = await ctx.rateLimiter.acquire(url);
          let data;
          try { data = await fetchWithRetry(url, { accept: 'json' }); }
          finally { release(); }

          const jobs = data?.results || [];
          if (jobs.length === 0) break;
          for (const j of jobs) {
            const link = j.redirect_url || j.url;
            if (!link || seen.has(link)) continue;
            seen.add(link);
            out.push(createJob({
              source: 'adzuna',
              source_kind: 'api',
              url: link,
              title: j.title,
              company: j.company?.display_name || '',
              location: j.location?.display_name || '',
              country: cc.toUpperCase(),
              description: stripHtml(j.description || ''),
              salary_min: j.salary_min ?? null,
              salary_max: j.salary_max ?? null,
              salary_currency: j.salary_is_predicted === '1' ? null : (countryToCurrency(cc)),
              employment_type: j.contract_time ? String(j.contract_time).toUpperCase().replace('-', '_') : null,
              posted_at: j.created,
              tags: [j.category?.tag, j.category?.label].filter(Boolean),
              raw: j,
            }));
          }
          if (jobs.length < RESULTS_PER_PAGE) break;
        }
      }
    }
  }
  return out;
}

function countryToCurrency(cc) {
  return ({
    gb: 'GBP', us: 'USD', de: 'EUR', fr: 'EUR', au: 'AUD', nz: 'NZD',
    ca: 'CAD', in: 'INR', pl: 'PLN', br: 'BRL', at: 'EUR', za: 'ZAR',
  })[cc] || null;
}
