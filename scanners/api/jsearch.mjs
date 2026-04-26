// scanners/api/jsearch.mjs — https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
//
// Aggregates Google for Jobs (Indeed/LinkedIn/ZipRecruiter/Glassdoor/etc.) via
// RapidAPI. Free tier is only ~200 req/month — useful for testing and a thin
// fallback layer; do not rely on it for primary ingestion.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'jsearch',
  kind: 'api',
  regions: ['worldwide', 'pakistan', 'gulf'],
  supports: { queries: true, locations: true, countries: true, max_pages: true, remote_only: true, employment_types: true },
  presets: {
    countries: ['us', 'gb', 'ae', 'sa', 'qa', 'om', 'bh', 'kw', 'pk', 'in'],
    employment_types: ['FULLTIME', 'CONTRACTOR', 'PARTTIME', 'INTERN'],
    queries: [],
    locations: [],
  },
  schema: {
    rapidapi_key: 'string  REQUIRED',
    queries: 'string[]      `query` parameter',
    locations: 'string[]    optional (concatenated to query)',
    countries: 'string[]    `country=`',
    remote_only: 'boolean   `remote_jobs_only=true`',
    employment_types: 'string[] `employment_types=`',
    max_pages: 'number      default 1 (free tier is 200 req/month!)',
  },
  docs: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
  requiresKey: true,
  envKeys: ['RAPIDAPI_KEY'],
  signupUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
  freeTier: '200 req / month (testing only) · global incl. PK + Gulf',
};

const BASE = 'https://jsearch.p.rapidapi.com/search';

export default async function fetchJsearch(config = {}, ctx) {
  const apiKey = config.rapidapi_key || process.env.RAPIDAPI_KEY;
  if (!apiKey) { ctx.log('warn', 'jsearch: rapidapi_key missing; skipping'); return []; }

  const queries = config.queries?.length ? config.queries : ['developer'];
  const locations = config.locations?.length ? config.locations : [''];
  const countries = config.countries?.length ? config.countries : ['us'];
  const maxPages = config.max_pages ?? 1;
  const empTypes = (config.employment_types || []).join(',');

  const headers = {
    'X-RapidAPI-Key': apiKey,
    'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
  };

  const out = [];
  const seen = new Set();

  for (const cc of countries) {
    for (const q of queries) {
      for (const loc of locations) {
        for (let page = 1; page <= maxPages; page++) {
          const params = new URLSearchParams({
            query: loc ? `${q} in ${loc}` : q,
            page: String(page),
            num_pages: '1',
            country: cc,
          });
          if (config.remote_only) params.set('remote_jobs_only', 'true');
          if (empTypes) params.set('employment_types', empTypes);
          const url = `${BASE}?${params}`;

          const release = await ctx.rateLimiter.acquire(url);
          let data;
          try { data = await fetchWithRetry(url, { accept: 'json', headers }); }
          finally { release(); }

          for (const j of (data?.data || [])) {
            const link = j.job_apply_link || j.job_google_link;
            if (!link || seen.has(link)) continue;
            seen.add(link);
            out.push(createJob({
              source: 'jsearch',
              source_kind: 'api',
              url: link,
              title: j.job_title,
              company: j.employer_name,
              location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', '),
              country: j.job_country,
              remote: !!j.job_is_remote,
              description: stripHtml(j.job_description || ''),
              salary_min: j.job_min_salary ?? null,
              salary_max: j.job_max_salary ?? null,
              salary_currency: j.job_salary_currency || null,
              employment_type: j.job_employment_type ? String(j.job_employment_type).toUpperCase() : null,
              posted_at: j.job_posted_at_datetime_utc,
              expires_at: j.job_offer_expiration_datetime_utc,
              tags: (j.job_required_skills || []).slice(0, 20),
              raw: j,
            }));
          }
        }
      }
    }
  }
  return out;
}
