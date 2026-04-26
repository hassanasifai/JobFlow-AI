// scanners/api/jooble.mjs — https://jooble.org/api/about
//
// Free aggregator API (key by request). 70+ countries including PK + entire
// Gulf. Endpoint is country-specific via subdomain: pk.jooble.org, ae.jooble.org,
// sa.jooble.org, qa.jooble.org, om.jooble.org, bh.jooble.org, kw.jooble.org.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'jooble',
  kind: 'api',
  regions: ['worldwide', 'pakistan', 'gulf', 'uae', 'saudi-arabia', 'qatar', 'oman', 'bahrain', 'kuwait'],
  supports: { queries: true, locations: true, countries: true, max_pages: true },
  presets: {
    countries: ['pk', 'ae', 'sa', 'qa', 'om', 'bh', 'kw', 'in', 'us', 'gb', 'de', 'fr', 'au', 'ca'],
    locations: [
      'Pakistan', 'Karachi', 'Lahore', 'Islamabad',
      'UAE', 'Dubai', 'Abu Dhabi',
      'Saudi Arabia', 'Riyadh', 'Jeddah',
      'Qatar', 'Doha', 'Oman', 'Muscat', 'Bahrain', 'Manama', 'Kuwait', 'Kuwait City',
    ],
    queries: [],
  },
  schema: {
    api_key: 'string  REQUIRED — request at jooble.org/api/about',
    queries: 'string[]   POST body `keywords`',
    locations: 'string[] POST body `location`',
    countries: 'string[] subdomain selector (cc.jooble.org), default ["us"]',
    max_pages: 'number  default 5',
  },
  docs: 'https://jooble.org/api/about',
  requiresKey: true,
  envKeys: ['JOOBLE_KEY'],
  signupUrl: 'https://jooble.org/api/about',
  freeTier: 'Free key by email request · 70+ countries incl. PK + Gulf',
};

export default async function fetchJooble(config = {}, ctx) {
  const apiKey = config.api_key || process.env.JOOBLE_KEY;
  if (!apiKey) { ctx.log('warn', 'jooble: api_key missing; skipping'); return []; }

  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const countries = config.countries?.length ? config.countries : ['us'];
  const maxPages = config.max_pages ?? 5;

  const out = [];
  const seen = new Set();

  for (const cc of countries) {
    for (const q of queries) {
      for (const loc of locations) {
        for (let page = 1; page <= maxPages; page++) {
          const url = `https://${cc}.jooble.org/api/${apiKey}`;
          const body = JSON.stringify({ keywords: q, location: loc, page });

          const release = await ctx.rateLimiter.acquire(url);
          let data;
          try {
            data = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body, accept: 'json',
            });
          } finally { release(); }

          const jobs = data?.jobs || [];
          if (jobs.length === 0) break;
          for (const j of jobs) {
            const link = j.link || j.url;
            if (!link || seen.has(link)) continue;
            seen.add(link);
            out.push(createJob({
              source: 'jooble',
              source_kind: 'api',
              url: link,
              title: j.title,
              company: j.company || '',
              location: j.location || loc,
              country: cc.toUpperCase(),
              description: stripHtml(j.snippet || ''),
              employment_type: j.type ? String(j.type).toUpperCase() : null,
              salary_currency: j.salary && /[A-Z]{3}/.test(j.salary) ? j.salary.match(/[A-Z]{3}/)[0] : null,
              posted_at: j.updated,
              raw: { ...j, _country: cc, _query: q, _location: loc },
            }));
          }
          if (jobs.length < 20) break;
        }
      }
    }
  }
  return out;
}
