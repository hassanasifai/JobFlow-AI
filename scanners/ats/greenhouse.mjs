// scanners/ats/greenhouse.mjs — Greenhouse public Job Board API
//
// Endpoint: https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// No auth. The token is the company's Greenhouse slug (e.g. "airbnb", "careem").

import { fetchWithRetry, createJob, stripHtml } from '../_base.mjs';

export const meta = {
  id: 'greenhouse',
  kind: 'ats',
  regions: ['worldwide'],
  supports: { companies: true },
  presets: {
    // Confirmed examples — frontend can pre-populate, user can add any slug.
    companies: ['airbnb', 'stripe', 'careem', 'figma', 'pinterest', 'cloudflare', 'datadog', 'gitlab', 'docker', 'discord'],
  },
  schema: {
    companies: 'string[]  list of Greenhouse board slugs (one per company)',
    eu: 'boolean          if true, also probe boards-api.eu.greenhouse.io for each slug',
  },
  docs: 'https://developers.greenhouse.io/job-board.html',
  requiresInputs: ['companies'],
};

const GH_HOSTS = {
  global: 'https://boards-api.greenhouse.io',
  eu: 'https://boards-api.eu.greenhouse.io',
};

export default async function fetchGreenhouse(config = {}, ctx) {
  const companies = (config.companies || []).filter(Boolean);
  if (companies.length === 0) return [];

  // EU subdomain hosts the same job board API for European-region tenants
  // (e.g. brand-new EU customers with data-residency requirements). When
  // `eu: true`, we probe both regions and merge the results — the global host
  // returns 404 for EU-only tenants and vice versa.
  const hosts = config.eu ? [GH_HOSTS.global, GH_HOSTS.eu] : [GH_HOSTS.global];

  const out = [];
  const seen = new Set();
  for (const slug of companies) {
    for (const host of hosts) {
      const url = `${host}/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
      const release = await ctx.rateLimiter.acquire(url);
      let data;
      try { data = await fetchWithRetry(url, { accept: 'json' }); }
      catch (err) {
        // 404 on the EU host for a global-only tenant (or vice versa) is expected — do not log noisily.
        if (!/404/.test(err.message)) ctx.log('warn', `greenhouse ${slug} @ ${host}: ${err.message}`);
        release();
        continue;
      }
      finally { release(); }

      for (const j of (data?.jobs || [])) {
        if (!j.absolute_url || seen.has(j.absolute_url)) continue;
        seen.add(j.absolute_url);
        out.push(createJob({
          source: 'greenhouse',
          source_kind: 'ats',
          url: j.absolute_url,
          title: j.title,
          company: data.meta?.name || slug,
          location: j.location?.name || '',
          description: stripHtml(j.content || ''),
          employment_type: (j.metadata || []).find((m) => /type/i.test(m.name))?.value || null,
          posted_at: j.updated_at,
          tags: (j.departments || []).map((d) => d.name),
          raw: { ...j, _gh_host: host },
        }));
      }
    }
  }
  return out;
}
