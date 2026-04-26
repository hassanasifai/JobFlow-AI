// scanners/sitemap/dubizzle.mjs — UAE classifieds, currently UNAVAILABLE.
//
// Status as of 2026-04: dubai.dubizzle.com sits behind Imperva/Incapsula bot
// protection. The sitemap URL returns an Incapsula challenge HTML body instead
// of XML when fetched without a real browser session, so direct scraping is
// infeasible without Playwright + a residential session.
//
// Rather than ship a silently-failing scraper, this adapter no-ops with a
// clear warning. **For UAE / Gulf coverage, use the ATS adapters** with the
// confirmed regional employer slugs in `templates/portals.example.yml`
// (greenhouse: careem, tamara, …). Greenhouse / Ashby / Lever publish
// structured JSON for free with no bot wall.
//
// If you want to revisit dubizzle scraping, the path forward is:
//   1. Move this adapter under scanners/scrape/ with `kind: 'scrape'`
//   2. Drive Playwright with stealth + a real UA + rotating residential proxies
//   3. Honor the Incapsula cooldown (30+ s) between requests
//   4. Set `acknowledge_tos_risk: true` like the LinkedIn scraper requires
// We do not ship this by default because it is fragile and crosses into
// ToS-grey territory.

import { createJob } from '../_base.mjs';

export const meta = {
  id: 'dubizzle',
  kind: 'sitemap',
  regions: ['uae', 'gulf'],
  supports: { languages: true, max_urls: true, queries: true },
  presets: { languages: ['en', 'ar'], queries: [] },
  schema: {
    languages: 'string[]  (currently unused — adapter is a no-op)',
    max_urls: 'number     (currently unused)',
    queries: 'string[]    (currently unused)',
    sitemap_root: 'string (currently unused)',
  },
  docs: 'https://dubai.dubizzle.com/jobs/',
  warning: 'Dubizzle sits behind Imperva/Incapsula. This adapter is a no-op until a Playwright-based replacement ships. For Gulf coverage, enable the greenhouse adapter with [careem, tamara, ...] in portals.yml.',
  unavailable: true,
};

// eslint-disable-next-line no-unused-vars
export default async function fetchDubizzle(config = {}, ctx) {
  ctx.log(
    'warn',
    'dubizzle: unavailable (Imperva/Incapsula bot wall). Use ATS adapters for Gulf companies — see meta.warning. To suppress this notice, set enabled: false in portals.yml.',
  );
  // Silence the unused createJob import warning without leaking jobs.
  void createJob;
  return [];
}
