// scanners/sitemap/qatarliving.mjs — Qatar classifieds, currently UNAVAILABLE.
//
// Status as of 2026-04: qatarliving.com publishes sitemap-static / -articles /
// -categories / -topics / -events / -pages, plus per-language vehicles
// sitemaps — but no `/jobs/` sitemap exists at all. The site's classifieds
// jobs section is rendered client-side from a closed API and is not
// crawlable via sitemap alone.
//
// **For Qatar coverage**, the ATS path works far better. Many Qatar-region
// employers use Greenhouse / Ashby / Lever with structured JSON. Add their
// slugs to `portals.yml` under the `greenhouse:` / `lever:` sections.

import { createJob } from '../_base.mjs';

export const meta = {
  id: 'qatarliving',
  kind: 'sitemap',
  regions: ['qatar', 'gulf'],
  supports: { languages: true, max_urls: true, queries: true },
  presets: { languages: ['en', 'ar'], queries: [] },
  schema: {
    languages: 'string[]  (currently unused)',
    max_urls: 'number     (currently unused)',
    queries: 'string[]    (currently unused)',
    sitemap_root: 'string (currently unused)',
  },
  docs: 'https://www.qatarliving.com/jobs',
  warning: 'qatarliving.com publishes no /jobs/ sitemap. This adapter is a no-op. For Qatar coverage use ATS adapters with regional employer slugs in portals.yml.',
  unavailable: true,
};

// eslint-disable-next-line no-unused-vars
export default async function fetchQatarLiving(config = {}, ctx) {
  ctx.log(
    'warn',
    'qatarliving: unavailable (no /jobs/ sitemap published). Use the greenhouse / lever / ashby adapters with Qatar-region employer slugs instead.',
  );
  void createJob;
  return [];
}
