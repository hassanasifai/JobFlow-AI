// scanners/sitemap/rozee.mjs — Rozee.pk (Pakistan), currently UNAVAILABLE.
//
// Status as of 2026-04: Rozee's detail pages 302-redirect through Cloudflare
// and do not expose JSON-LD JobPosting blocks (verified by direct GET on
// several published sitemap URLs). The published sitemap index at
// /sitemap/sitemap_index.xml lists detail URLs but each one renders an
// HTML page with no structured data, so there is nothing reliable to scrape
// without a heavier strategy (Playwright + AI parsing).
//
// Pakistan coverage is already strong without Rozee:
//   - mustakbil RSS  → ~500 active PK jobs (verified live)
//   - careem on Greenhouse  → PK/UAE/KSA/Egypt jobs with structured JSON
//   - mustakbil categories filter → city-level filter (Karachi, Lahore, …)
//
// Aligned with the project spec: "Do not prioritize LinkedIn, Indeed,
// Glassdoor, Bayt, NaukriGulf, Rozee, Monster" — those sites either block
// scraping or require browser automation that crosses ToS.
//
// If you want to revive this adapter:
//   1. Move it under scanners/scrape/ with `kind: 'scrape'`
//   2. Drive Playwright + cookies + a residential UA to clear Cloudflare
//   3. Parse the rendered HTML title/description manually (no JSON-LD)
//   4. Set `acknowledge_tos_risk: true` like the LinkedIn-guest scraper does

import { createJob } from '../_base.mjs';

export const meta = {
  id: 'rozee',
  kind: 'sitemap',
  regions: ['pakistan'],
  supports: { max_urls: true, queries: true },
  presets: { queries: [] },
  schema: {
    max_urls: 'number     (currently unused)',
    queries: 'string[]    (currently unused)',
    sitemap_root: 'string (currently unused)',
  },
  docs: 'https://www.rozee.pk/jobs',
  warning: 'Rozee detail pages 302 through Cloudflare with no JSON-LD payload. Adapter is a no-op. Use mustakbil + greenhouse[careem] for PK coverage instead.',
  unavailable: true,
};

// eslint-disable-next-line no-unused-vars
export default async function fetchRozee(config = {}, ctx) {
  ctx.log(
    'warn',
    'rozee: unavailable (Cloudflare-fronted detail pages with no JSON-LD). For Pakistan coverage use mustakbil + greenhouse with careem in companies list.',
  );
  void createJob;
  return [];
}
