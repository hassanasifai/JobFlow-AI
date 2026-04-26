import { normalizeLocation as classifyLocation } from './_normalize.mjs';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gh_src', 'gh_jid', 'lever-source', 'source', 'ref', 'referrer',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid',
]);

export function normalizeUrl(input) {
  if (!input) return '';
  try {
    const u = new URL(String(input).trim());
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${u.protocol}//${u.host}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return String(input).trim();
  }
}

export function normalizeCompany(company) {
  return normalizeWords(company)
    .replace(/\b(incorporated|inc|llc|ltd|limited|gmbh|plc|corp|corporation|co|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(title) {
  return normalizeWords(title)
    .replace(/\b(sr|snr)\b/g, 'senior')
    .replace(/\bfullstack\b/g, 'full stack')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocation(location) {
  const classified = classifyLocation(location);
  const tokens = normalizeWords(location)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
  return [classified.region_group, classified.country_code || '', tokens].filter(Boolean).join(':');
}

export function createJobFingerprint(job = {}) {
  return [
    normalizeCompany(job.company),
    normalizeTitle(job.title),
    normalizeLocation(job.location),
  ].join('|');
}

export function isDuplicate(job = {}, existingJobs = []) {
  const sourceKey = job.source && job.source_id ? `${job.source}::${job.source_id}` : null;
  const url = normalizeUrl(job.url);
  const applyUrl = normalizeUrl(job.apply_url);
  const fp = createJobFingerprint(job);

  for (const existing of existingJobs) {
    if (sourceKey && existing.source && existing.source_id && sourceKey === `${existing.source}::${existing.source_id}`) {
      return true;
    }
    if (url && normalizeUrl(existing.url) === url) return true;
    if (applyUrl && normalizeUrl(existing.apply_url) === applyUrl) return true;
    if (fp === createJobFingerprint(existing) && withinSevenDays(job.date_posted || job.posted_at, existing.date_posted || existing.posted_at)) {
      return true;
    }
  }
  return false;
}

function withinSevenDays(a, b) {
  if (!a || !b) return true;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return true;
  return Math.abs(da.getTime() - db.getTime()) <= 7 * 24 * 60 * 60 * 1000;
}

function normalizeWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
