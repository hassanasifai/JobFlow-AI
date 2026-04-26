// scanners/api/careerjet.mjs — https://www.careerjet.com/partners/api.html
//
// Free official partner API; requires affiliate ID. Supports per-country locales
// (en_PK, en_AE, en_SA, en_QA, en_OM, en_BH, en_KW, etc.) so this single adapter
// covers Pakistan + the entire Gulf in one place.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'careerjet',
  kind: 'api',
  regions: ['worldwide', 'pakistan', 'gulf', 'uae', 'saudi-arabia', 'qatar', 'oman', 'bahrain', 'kuwait'],
  supports: { queries: true, locations: true, locales: true, max_pages: true },
  presets: {
    locales: [
      'en_PK', 'ur_PK', 'en_AE', 'ar_AE', 'en_SA', 'ar_SA', 'en_QA', 'ar_QA',
      'en_OM', 'ar_OM', 'en_BH', 'ar_BH', 'en_KW', 'ar_KW',
      'en_GB', 'en_US', 'en_IN', 'en_GB',
    ],
    locations: [
      'Pakistan', 'Karachi', 'Lahore', 'Islamabad',
      'United Arab Emirates', 'Dubai', 'Abu Dhabi',
      'Saudi Arabia', 'Riyadh', 'Jeddah',
      'Qatar', 'Doha', 'Oman', 'Muscat', 'Bahrain', 'Kuwait',
    ],
    queries: [],
  },
  schema: {
    affiliate_id: 'string  REQUIRED — sign up at careerjet.com/partners (free)',
    queries: 'string[]     keywords for &keywords=',
    locations: 'string[]   passed to &location=',
    locales: 'string[]     locale codes; defines country/site (default en_GB)',
    max_pages: 'number     default 10',
    pagesize: 'number      default 99 (max)',
  },
  docs: 'https://www.careerjet.com/partners/api/',
  requiresKey: true,
  envKeys: ['CAREERJET_AFFILIATE'],
  signupUrl: 'https://www.careerjet.com/partners/',
  freeTier: 'Free affiliate ID, generous quota · PK + entire Gulf supported',
};

const BASE = 'https://public.api.careerjet.net/search';

export default async function fetchCareerjet(config = {}, ctx) {
  const affiliateId = config.affiliate_id || process.env.CAREERJET_AFFILIATE;
  if (!affiliateId) {
    ctx.log('warn', 'careerjet: affiliate_id missing; skipping');
    return [];
  }
  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const locales = config.locales?.length ? config.locales : ['en_GB'];
  const maxPages = config.max_pages ?? 10;
  const pagesize = Math.min(config.pagesize ?? 99, 99);

  const out = [];
  const seen = new Set();

  for (const q of queries) {
    for (const loc of locations) {
      for (const locale of locales) {
        for (let page = 1; page <= maxPages; page++) {
          const params = new URLSearchParams({
            affid: affiliateId,
            locale_code: locale,
            pagesize: String(pagesize),
            page: String(page),
            // CareerJet wants explicit user_ip + user_agent; harmless dummy values
            // are accepted for server-side use cases.
            user_ip: '0.0.0.0',
            user_agent: 'career-ops-scanner/2.0',
          });
          if (q) params.set('keywords', q);
          if (loc) params.set('location', loc);
          const url = `${BASE}?${params}`;

          const release = await ctx.rateLimiter.acquire(url);
          let data;
          try { data = await fetchWithRetry(url, { accept: 'json' }); }
          finally { release(); }

          if (data?.type === 'ERROR') {
            ctx.log('error', `careerjet error: ${data.error}`);
            break;
          }
          const jobs = data?.jobs || [];
          if (jobs.length === 0) break;
          for (const j of jobs) {
            if (!j.url || seen.has(j.url)) continue;
            seen.add(j.url);
            out.push(createJob({
              source: 'careerjet',
              source_kind: 'api',
              url: j.url,
              title: j.title,
              company: j.company,
              location: j.locations || loc,
              country: locale.split('_')[1],
              description: stripHtml(j.description || ''),
              salary_currency: j.salary_currency_code || null,
              posted_at: j.date,
              raw: j,
            }));
          }
          if ((data?.pages || 1) <= page) break;
        }
      }
    }
  }
  return out;
}
