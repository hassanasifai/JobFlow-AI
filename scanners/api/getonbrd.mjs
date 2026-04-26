// scanners/api/getonbrd.mjs — https://www.getonbrd.com/api/v0
//
// Largest Latin-American tech job board. Their public JSON:API exposes jobs
// per category (programming, design, data-science, devops, …). Free, no auth.
// Verified alive January 2026 — 617 KB JSON for the default programming feed.
//
// Worth wiring even if you're not in LATAM: many of the postings are
// remote-friendly worldwide, especially senior+ Spanish-speaking roles.

import { fetchWithRetry, createJob, stripHtml, slugify } from '../_base.mjs';

export const meta = {
  id: 'getonbrd',
  kind: 'api',
  regions: ['latam', 'worldwide-remote'],
  supports: { queries: true, categories: true, max_pages: true, remote_only: true },
  presets: {
    categories: ['programming', 'design-ux', 'mobile-developer', 'devops-sysadmin', 'data-science-analytics', 'qa-testing'],
    queries: [],
  },
  schema: {
    queries: 'string[]      client-side keyword match',
    categories: 'string[]   one fetch per category, default ["programming"]',
    max_pages: 'number       default 2 (×20 = 40 per category)',
    remote_only: 'boolean    default false',
  },
  docs: 'https://www.getonbrd.com/api/v0/categories',
};

const BASE = 'https://www.getonbrd.com/api/v0/categories';

export default async function fetchGetOnboard(config = {}, ctx) {
  const cats = (config.categories?.length ? config.categories : ['programming']).map(String);
  const queries = (config.queries || []).map((q) => String(q).toLowerCase()).filter(Boolean);
  const maxPages = Math.max(1, Math.min(10, Number(config.max_pages) || 2));
  const remoteOnly = config.remote_only === true;

  const out = [];
  const seen = new Set();
  for (const cat of cats) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${BASE}/${encodeURIComponent(cat)}/jobs?page=${page}&per_page=20`;
      const release = await ctx.rateLimiter.acquire(url);
      let data;
      try { data = await fetchWithRetry(url, { accept: 'json' }); }
      catch (err) { ctx.log('warn', `getonbrd ${cat} p${page}: ${err.message}`); release(); break; }
      finally { release(); }

      const items = Array.isArray(data?.data) ? data.data : [];
      if (items.length === 0) break;
      for (const item of items) {
        // Get on Board returns a flat object per entry (NOT JSON:API
        // nested under `attributes`). Accept both shapes defensively.
        const a = item.attributes || item;
        // The job-detail URL isn't in the payload — synthesize from id/slug.
        const link = a.public_url || a.url ||
          (item.id && a.title ? `https://www.getonbrd.com/jobs/${cat}/${slugify(a.title)}-${item.id}` : null) ||
          (a.id ? `https://www.getonbrd.com/jobs/${a.id}` : null);
        if (!link || seen.has(link)) continue;
        seen.add(link);
        const remote = a.remote === true || /remote|anywhere|worldwide/i.test(a.modality || '');
        if (remoteOnly && !remote) continue;
        const title = a.title;
        if (!title) continue;
        if (queries.length) {
          const blob = `${title} ${a.functions || ''} ${a.description || ''}`.toLowerCase();
          if (!queries.some((q) => blob.includes(q))) continue;
        }

        // company is a nested resource: item.relationships.company.data.id
        // — but getonbrd ALSO surfaces a flat `company` field with a name.
        const companyName = (a.company && (a.company.data?.attributes?.name || a.company.name)) || a.company_name || 'Unknown';

        out.push(createJob({
          source: 'getonbrd',
          source_kind: 'api',
          source_id: String(item.id || a.id || link),
          url: link,
          title,
          company: companyName,
          location: a.location_cities?.[0] || a.countries?.[0] || (remote ? 'Remote' : ''),
          remote,
          region: remote ? ['latam', 'worldwide-remote'] : ['latam'],
          description: stripHtml(a.description || a.functions || ''),
          salary_min: a.min_salary ?? null,
          salary_max: a.max_salary ?? null,
          salary_currency: a.salary_currency || 'USD',
          employment_type: a.modality ? String(a.modality).toUpperCase().replace(/[\s-]/g, '_') : null,
          posted_at: a.published_at ? new Date(a.published_at * 1000).toISOString() : null,
          tags: Array.isArray(a.tags) ? a.tags.map((t) => t?.name || String(t)).filter(Boolean) : [],
          raw: { ...a, _cat: cat },
        }));
      }
      if (items.length < 20) break;
    }
  }
  return out;
}
