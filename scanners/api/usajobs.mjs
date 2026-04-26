// scanners/api/usajobs.mjs — https://developer.usajobs.gov
//
// US federal-government jobs (public-domain data). Free, generous quota.
// Useful for "remote in the US" public-sector roles.

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'usajobs',
  kind: 'api',
  regions: ['usa', 'worldwide-remote'],
  supports: { queries: true, locations: true, max_pages: true, remote_only: true },
  presets: {
    locations: ['Anywhere in the US', 'Washington, DC', 'New York, NY', 'San Francisco, CA'],
    queries: [],
  },
  schema: {
    user_email: 'string  REQUIRED — your email, sent in the User-Agent header',
    api_key: 'string     REQUIRED — free at developer.usajobs.gov',
    queries: 'string[]   `Keyword` parameter',
    locations: 'string[] `LocationName` parameter',
    remote_only: 'boolean filters to telework-eligible only',
    max_pages: 'number   default 3 (×500 = 1500 max)',
  },
  docs: 'https://developer.usajobs.gov/api-reference',
  requiresKey: true,
  envKeys: ['USAJOBS_USER_EMAIL', 'USAJOBS_API_KEY'],
  signupUrl: 'https://developer.usajobs.gov/apirequest/',
  freeTier: 'Free key · US public-sector roles (federal jobs)',
};

const BASE = 'https://data.usajobs.gov/api/search';

export default async function fetchUsajobs(config = {}, ctx) {
  const userEmail = config.user_email || process.env.USAJOBS_USER_EMAIL;
  const apiKey = config.api_key || process.env.USAJOBS_API_KEY;
  if (!userEmail || !apiKey) { ctx.log('warn', 'usajobs: user_email/api_key missing; skipping'); return []; }

  const queries = config.queries?.length ? config.queries : [''];
  const locations = config.locations?.length ? config.locations : [''];
  const maxPages = config.max_pages ?? 3;

  const headers = {
    'Host': 'data.usajobs.gov',
    'User-Agent': userEmail,
    'Authorization-Key': apiKey,
  };

  const out = [];
  const seen = new Set();

  for (const q of queries) {
    for (const loc of locations) {
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({ ResultsPerPage: '500', Page: String(page) });
        if (q) params.set('Keyword', q);
        if (loc) params.set('LocationName', loc);
        if (config.remote_only) params.set('RemoteIndicator', 'true');
        const url = `${BASE}?${params}`;

        const release = await ctx.rateLimiter.acquire(url);
        let data;
        try { data = await fetchWithRetry(url, { accept: 'json', headers }); }
        finally { release(); }

        const items = data?.SearchResult?.SearchResultItems || [];
        if (items.length === 0) break;
        for (const it of items) {
          const desc = it.MatchedObjectDescriptor;
          if (!desc) continue;
          const link = desc.PositionURI || desc.ApplyURI?.[0];
          if (!link || seen.has(link)) continue;
          seen.add(link);
          const remuneration = desc.PositionRemuneration?.[0] || {};
          out.push(createJob({
            source: 'usajobs',
            source_kind: 'api',
            url: link,
            title: desc.PositionTitle,
            company: desc.OrganizationName,
            location: (desc.PositionLocationDisplay || (desc.PositionLocation || []).map((l) => l.LocationName).join(', ')),
            country: 'USA',
            description: stripHtml(desc.QualificationSummary || desc.UserArea?.Details?.JobSummary || ''),
            salary_min: remuneration.MinimumRange ? Number(remuneration.MinimumRange) : null,
            salary_max: remuneration.MaximumRange ? Number(remuneration.MaximumRange) : null,
            salary_currency: 'USD',
            employment_type: (desc.PositionSchedule?.[0]?.Name || '').toUpperCase().replace(/[^A-Z]/g, '_') || null,
            posted_at: desc.PublicationStartDate,
            expires_at: desc.ApplicationCloseDate,
            tags: (desc.JobCategory || []).map((c) => c.Name),
            raw: desc,
          }));
        }
      }
    }
  }
  return out;
}
