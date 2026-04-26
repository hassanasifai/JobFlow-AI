// scanners/api/web3career.mjs — currently UNAVAILABLE.
//
// Status as of 2026-04: web3.career's free `/api/v1?token=public` endpoint
// 302-redirects on direct GETs and the redirect target rejects requests with
// `Accept: application/json` (HTTP 406). Their public API has shifted since
// we wired this adapter — it no longer serves JSON to anonymous clients.
//
// Rather than spam the dashboard with HTTP 406 errors every scan, we mark
// the adapter `unavailable: true` so the registry skips it cleanly and the
// Sources Health page displays an honest reason. Re-enabling is a 5-minute
// reverse once the API stabilises.
//
// **For crypto / web3 roles in the meantime**, remoteok and arbeitnow both
// surface a healthy stream of crypto-flavoured remote jobs.

import { createJob } from '../_base.mjs';

export const meta = {
  id: 'web3career',
  kind: 'api',
  regions: ['worldwide-remote', 'worldwide'],
  supports: { queries: true, tags: true, max_pages: true },
  presets: { tags: [], queries: [] },
  schema: {
    api_token: 'string?  (currently unused)',
    queries: 'string[]   (currently unused)',
    tags: 'string[]      (currently unused)',
    max_pages: 'number   (currently unused)',
  },
  docs: 'https://web3.career/api',
  warning: 'Public API changed (302 → 406 with Accept: application/json). Adapter is a no-op until the endpoint is restored. Use remoteok / arbeitnow for crypto roles.',
  unavailable: true,
};

// eslint-disable-next-line no-unused-vars
export default async function fetchWeb3Career(config = {}, ctx) {
  ctx.log(
    'warn',
    'web3career: unavailable (API endpoint changed — 302 redirect rejects JSON). Use remoteok / arbeitnow for crypto-flavoured remote jobs.',
  );
  void createJob;
  return [];
}
