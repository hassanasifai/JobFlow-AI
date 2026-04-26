// scanners/rss/jobspresso.mjs — Jobspresso RSS, currently UNAVAILABLE.
//
// Status as of 2026-04: jobspresso.co/feed/ returns a valid RSS document but
// the `<channel>` is empty — there are zero `<item>` entries. Jobspresso seems
// to have stopped syndicating to RSS some time ago. Until they restore the
// feed (or we add an HTML scraper), this adapter no-ops.
//
// **For worldwide-remote coverage**, weworkremotely + remotive + remoteok +
// arbeitnow + himalayas already return thousands of jobs combined.

import { createJob } from '../_base.mjs';

export const meta = {
  id: 'jobspresso',
  kind: 'rss',
  regions: ['worldwide-remote'],
  supports: { queries: true, categories: true },
  presets: { queries: [], categories: [] },
  schema: {
    queries: 'string[]    (currently unused)',
    categories: 'string[] (currently unused)',
  },
  docs: 'https://jobspresso.co/remote-work/',
  warning: 'Jobspresso RSS feed has been empty for an extended period. This adapter is a no-op until they restore syndication. Use weworkremotely/remotive/arbeitnow for worldwide-remote.',
  unavailable: true,
};

// eslint-disable-next-line no-unused-vars
export default async function fetchJobspresso(config = {}, ctx) {
  ctx.log(
    'warn',
    'jobspresso: feed empty (no <item> entries). Adapter is a no-op. Use weworkremotely / remotive / arbeitnow for remote coverage.',
  );
  void createJob;
  return [];
}
