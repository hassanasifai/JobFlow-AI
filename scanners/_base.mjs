// scanners/_base.mjs
// Foundation for all job-source adapters: shared Job schema, fetch w/ retry,
// per-domain rate limiting, robots.txt cache, circuit breaker, RSS / sitemap /
// JSON-LD parsers, region + remote inference, salary extraction.
//
// Adapters import from this file and export:
//   export const meta = { id, kind, regions, supports, presets, schema }
//   export default async function fetch(config, ctx) -> Job[]
//
// Nothing here is hardcoded for a particular role or geography — every
// keyword/query/region/category comes from the caller's config.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { normalizeJob } from './_normalize.mjs';
import { normalizeUrl } from './_dedupe.mjs';

// ── Job schema ──────────────────────────────────────────────────────

/**
 * Build a normalized Job. All fields except url/title/company are optional.
 * @param {object} partial
 * @returns {Job}
 */
export function createJob(partial) {
  if (!partial.url || !partial.title) {
    return null;
  }
  const url = canonicalUrl(partial.url);
  const company = (partial.company || '').trim() || 'Unknown';

  const j = normalizeJob({
    source: partial.source || 'unknown',
    source_kind: partial.source_kind || 'unknown',
    source_id: partial.source_id || partial.id || partial.raw?.id || partial.raw?.shortcode || url,
    url,
    title: partial.title.trim(),
    company,
    location: (partial.location || '').trim(),
    remote: partial.remote ?? null,
    region: Array.isArray(partial.region) ? partial.region : [],
    description: partial.description || null,
    salary_min: partial.salary_min ?? null,
    salary_max: partial.salary_max ?? null,
    salary_currency: partial.salary_currency || null,
    employment_type: partial.employment_type || null,
    posted_at: partial.posted_at || null,
    expires_at: partial.expires_at || null,
    tags: Array.isArray(partial.tags) ? partial.tags : [],
    apply_url: partial.apply_url || url,
    description_html: partial.description_html || partial.description || '',
    raw: partial.raw ?? null,
  });

  // Auto-infer remote/region if not explicitly set.
  if (j.remote === null) j.remote = inferRemote(`${j.title} ${j.location} ${j.description ?? ''}`);
  if (!Array.isArray(j.region)) j.region = [];
  if (j.region.length === 0) j.region = inferRegions(j.location, partial.country);
  return j;
}

// ── URL normalization for dedup ────────────────────────────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gh_src', 'gh_jid', 'lever-source', 'source', 'ref', 'referrer',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid',
]);

export function canonicalUrl(input) {
  return normalizeUrl(input);
}

// ── Region + remote inference ──────────────────────────────────────

const REMOTE_REGEX = /\b(remote|work[\s-]from[\s-]home|wfh|distributed|anywhere|fully[\s-]remote|telecommute)\b/i;

export function inferRemote(text) {
  if (!text) return false;
  return REMOTE_REGEX.test(text);
}

const REGION_RULES = [
  { tag: 'pakistan',     match: /\b(pakistan|karachi|lahore|islamabad|rawalpindi|peshawar|multan|faisalabad|quetta|sialkot)\b/i },
  { tag: 'uae',          match: /\b(uae|united arab emirates|dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah)\b/i },
  { tag: 'saudi-arabia', match: /\b(saudi arabia|ksa|riyadh|jeddah|dammam|mecca|medina|khobar|dhahran)\b/i },
  { tag: 'qatar',        match: /\b(qatar|doha|al rayyan|al wakrah)\b/i },
  { tag: 'oman',         match: /\b(oman|muscat|salalah|sohar)\b/i },
  { tag: 'bahrain',      match: /\b(bahrain|manama|riffa|muharraq)\b/i },
  { tag: 'kuwait',       match: /\b(kuwait|kuwait city)\b/i },
  { tag: 'gulf',         match: /\b(gcc|gulf|middle east|mena)\b/i },
];

export function inferRegions(location, country) {
  const out = new Set();
  const text = `${location || ''} ${country || ''}`;
  for (const { tag, match } of REGION_RULES) if (match.test(text)) out.add(tag);
  if (['uae', 'saudi-arabia', 'qatar', 'oman', 'bahrain', 'kuwait'].some(t => out.has(t))) out.add('gulf');
  if (out.size === 0 && /remote|anywhere|worldwide|global/i.test(text)) out.add('worldwide-remote');
  return [...out];
}

// ── Salary extraction ──────────────────────────────────────────────

const CURRENCY_SYMBOLS = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  'AED': 'AED', 'SAR': 'SAR', 'QAR': 'QAR', 'OMR': 'OMR', 'BHD': 'BHD', 'KWD': 'KWD',
  'PKR': 'PKR', 'INR': 'INR', 'EGP': 'EGP',
};

export function parseSalaryText(text) {
  if (!text) return null;
  const s = String(text).replace(/,/g, '');
  // Currency
  let currency = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (s.includes(sym)) { currency = code; break; }
  }
  if (!currency) {
    const m = s.match(/\b(USD|EUR|GBP|AED|SAR|QAR|OMR|BHD|KWD|PKR|INR|EGP|JPY|CHF|CAD|AUD)\b/i);
    if (m) currency = m[1].toUpperCase();
  }
  // Range or single. The "[^0-9]*" gap after the dash absorbs an optional
  // second currency symbol (e.g. "$120,000 - $150,000" after comma-strip)
  // and any stray spaces — without it we'd silently truncate ranges to the
  // lower bound.
  const rangeMatch = s.match(/(\d{2,7})\s*(?:k|K)?[^0-9]+(\d{2,7})\s*(?:k|K)?/);
  if (rangeMatch) {
    const mult = /K/i.test(rangeMatch[0]) ? 1000 : 1;
    return { min: parseInt(rangeMatch[1], 10) * mult, max: parseInt(rangeMatch[2], 10) * mult, currency };
  }
  const singleMatch = s.match(/(\d{2,7})\s*(k|K)?/);
  if (singleMatch) {
    const mult = singleMatch[2] ? 1000 : 1;
    const v = parseInt(singleMatch[1], 10) * mult;
    return { min: v, max: v, currency };
  }
  return null;
}

// ── HTTP fetch with retry / backoff / timeout ──────────────────────

/**
 * Resolves the User-Agent string. The contact email is read from SCANNER_EMAIL
 * (recommended for production so site operators can reach you) and falls back
 * to a placeholder. We log a one-time warning when the placeholder is used so
 * operators notice during their first run.
 */
let _uaWarned = false;
export function getScannerUserAgent() {
  const email = (process.env.SCANNER_EMAIL || '').trim();
  if (!email && !_uaWarned) {
    _uaWarned = true;
    process.stderr.write(
      'warn: SCANNER_EMAIL not set — using placeholder. Set SCANNER_EMAIL=you@example.com in .env so source operators can reach you.\n',
    );
  }
  const contact = email || 'ops@example.com';
  return `career-ops-scanner/2.0 (+https://github.com/santifer/career-ops; contact: ${contact})`;
}

const DEFAULT_UA = getScannerUserAgent();

export class FetchError extends Error {
  constructor(message, { status, url, retriable } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.retriable = retriable;
  }
}

/**
 * Fetch with timeout, retry on 5xx + network errors, honors 429 Retry-After.
 * @param {string} url
 * @param {{
 *   headers?: Record<string,string>,
 *   method?: string,
 *   body?: string,
 *   timeoutMs?: number,
 *   retries?: number,
 *   accept?: 'json'|'text'|'buffer',
 *   signal?: AbortSignal,
 * }} opts
 */
export async function fetchWithRetry(url, opts = {}) {
  const {
    headers = {},
    method = 'GET',
    body,
    timeoutMs = 15_000,
    retries = 3,
    accept = 'json',
    signal,
    cacheTtlMs = defaultCacheTtlMs(url),
  } = opts;

  const cacheEnabled = accept !== 'buffer'
    && cacheTtlMs > 0
    && process.env.CAREER_OPS_NO_CACHE !== '1';
  const cachePath = cacheEnabled ? responseCachePath(url, accept) : null;
  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
      if (Date.now() - cached.timestamp <= cacheTtlMs) {
        return accept === 'json' ? cached.body : String(cached.body ?? '');
      }
    } catch { /* corrupt cache: refetch */ }
  }

  const finalHeaders = {
    'User-Agent': DEFAULT_UA,
    'Accept': accept === 'json' ? 'application/json' : (accept === 'text' ? 'text/html,application/xhtml+xml,application/xml' : '*/*'),
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers,
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const res = await fetch(url, { method, headers: finalHeaders, body, signal: controller.signal, redirect: 'follow' });

      if (res.status === 429) {
        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
        const wait = Math.max(ra * 1000, 60_000);
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw new FetchError(`HTTP 429 ${url}`, { status: 429, url, retriable: false });
      }

      if (res.status >= 500 && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status} ${url}`, { status: res.status, url, retriable: false });
      }

      let bodyOut;
      if (accept === 'json') bodyOut = await res.json();
      else if (accept === 'buffer') bodyOut = Buffer.from(await res.arrayBuffer());
      else bodyOut = await res.text();
      if (cachePath && accept !== 'buffer') {
        try {
          mkdirSync(path.dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, JSON.stringify({ timestamp: Date.now(), url, accept, body: bodyOut }), 'utf-8');
        } catch { /* cache is best-effort */ }
      }
      return bodyOut;
    } catch (err) {
      lastErr = err;
      const retriable = err.name === 'AbortError' || /network|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND/i.test(err.message);
      if (attempt < retries && retriable) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr;
}

function responseCachePath(url, accept) {
  const root = process.env.CAREER_OPS_CACHE_DIR || path.join('data', 'cache', 'job-sources');
  const provider = providerFromUrl(url);
  const hash = createHash('sha256').update(`${accept}:${url}`).digest('hex');
  return path.join(root, provider, `${hash}.json`);
}

function defaultCacheTtlMs(url) {
  const provider = providerFromUrl(url);
  const hours = {
    remoteok: 6,
    remotive: 6,
    arbeitnow: 6,
    workable: 6,
    personio: 2,
    greenhouse: 1,
    lever: 1,
    ashby: 1,
    recruitee: 1,
    smartrecruiters: 1,
  }[provider] ?? 1;
  return hours * 60 * 60 * 1000;
}

function providerFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('remoteok.com')) return 'remoteok';
    if (host.includes('remotive.com')) return 'remotive';
    if (host.includes('arbeitnow.com')) return 'arbeitnow';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('personio.')) return 'personio';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('recruitee.com')) return 'recruitee';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (host.includes('adzuna.com')) return 'adzuna';
    if (host.includes('usajobs.gov')) return 'usajobs';
    return host.replace(/[^a-z0-9.-]/g, '_');
  } catch {
    return 'unknown';
  }
}

function backoffMs(attempt) {
  return Math.min(30_000, 500 * Math.pow(2, attempt) + Math.random() * 250);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Per-domain rate limiter ────────────────────────────────────────

const domainQueues = new Map();

export class RateLimiter {
  constructor({ minIntervalMs = 2000 } = {}) {
    this.minIntervalMs = minIntervalMs;
  }

  /** Awaitable acquire: ensures requests to the same domain are spaced out. */
  async acquire(url) {
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const prev = domainQueues.get(host) || Promise.resolve(0);
    let release;
    const next = new Promise((res) => { release = res; });
    domainQueues.set(host, next);
    const lastTs = await prev;
    const wait = Math.max(0, this.minIntervalMs - (Date.now() - lastTs));
    if (wait > 0) await sleep(wait);
    return () => release(Date.now());
  }
}

// ── Robots.txt cache ───────────────────────────────────────────────

const robotsCache = new Map();

/**
 * Returns true if `url` is allowed to be fetched under our UA.
 * Caches robots.txt per host for the process lifetime.
 * Fail-open on errors (assume allowed) — adapters that need strict compliance
 * can pass `strict: true`.
 */
export async function isAllowedByRobots(url, { ua = DEFAULT_UA, strict = false } = {}) {
  let host;
  try { host = new URL(url).origin; } catch { return true; }
  if (!robotsCache.has(host)) {
    robotsCache.set(host, fetchRobots(host, ua).catch(() => null));
  }
  const rules = await robotsCache.get(host);
  if (!rules) return !strict; // fail open / closed
  return checkRobots(rules, ua, new URL(url).pathname + (new URL(url).search || ''));
}

async function fetchRobots(origin, ua) {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': ua } });
    if (!res.ok) return null;
    return parseRobots(await res.text());
  } catch { return null; }
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current._closed) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(val.toLowerCase());
    } else if (current) {
      current._closed = true;
      if (key === 'disallow') current.rules.push({ allow: false, path: val });
      else if (key === 'allow') current.rules.push({ allow: true, path: val });
      else if (key === 'crawl-delay') current.crawlDelay = parseFloat(val) || null;
    }
  }
  return groups;
}

function checkRobots(groups, ua, path) {
  const uaLower = ua.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => uaLower.includes(a))) ||
              groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  // Longest-match wins; allow > disallow on tie
  let bestLen = -1, bestAllow = true;
  for (const r of group.rules) {
    if (!r.path) continue;
    const matched = matchRobotPath(r.path, path);
    if (matched && r.path.length > bestLen) { bestLen = r.path.length; bestAllow = r.allow; }
    else if (matched && r.path.length === bestLen && r.allow) bestAllow = true;
  }
  return bestLen === -1 ? true : bestAllow;
}

function matchRobotPath(pattern, path) {
  // Support * and $ per Google's robots spec
  const regexStr = '^' + pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp(regexStr).test(path);
}

// ── Circuit breaker (per source) ───────────────────────────────────

export class CircuitBreaker {
  constructor({ threshold = 5, cooldownMs = 5 * 60_000 } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.state = new Map();
  }
  isOpen(key) {
    const s = this.state.get(key);
    if (!s) return false;
    if (s.openUntil && Date.now() < s.openUntil) return true;
    return false;
  }
  recordSuccess(key) { this.state.set(key, { failures: 0, openUntil: 0 }); }
  recordFailure(key) {
    const s = this.state.get(key) || { failures: 0, openUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.threshold) s.openUntil = Date.now() + this.cooldownMs;
    this.state.set(key, s);
  }
}

// ── XML / RSS / sitemap parsers ────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  parseTagValue: true,
  trimValues: true,
  // Large feeds (e.g. weworkremotely) trigger XXE protection limits if entity
  // processing is on. We don't rely on entity expansion, so disable it.
  processEntities: false,
});

export function parseXml(xml) {
  return xmlParser.parse(xml);
}

/** RSS 2.0 → array of normalized items. */
export function parseRss(xml) {
  const doc = xmlParser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) return [];
  const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
  return items.map((it) => ({
    title: text(it.title),
    link: text(it.link),
    description: text(it.description) || text(it['content:encoded']),
    pubDate: text(it.pubDate),
    category: Array.isArray(it.category) ? it.category.map(text) : (it.category ? [text(it.category)] : []),
    author: text(it['dc:creator']) || text(it.author),
    guid: text(it.guid),
    raw: it,
  }));
}

/** sitemap.xml or sitemap-index → array of {loc, lastmod, sub?} */
export function parseSitemap(xml) {
  const doc = xmlParser.parse(xml);
  if (doc.sitemapindex?.sitemap) {
    const arr = Array.isArray(doc.sitemapindex.sitemap) ? doc.sitemapindex.sitemap : [doc.sitemapindex.sitemap];
    return arr.map((s) => ({ loc: text(s.loc), lastmod: text(s.lastmod), sub: true }));
  }
  if (doc.urlset?.url) {
    const arr = Array.isArray(doc.urlset.url) ? doc.urlset.url : [doc.urlset.url];
    return arr.map((u) => ({ loc: text(u.loc), lastmod: text(u.lastmod), sub: false }));
  }
  return [];
}

export function xmlText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v.__cdata) return String(v.__cdata);
  if (v['#text']) return String(v['#text']);
  if (Array.isArray(v)) return v.map(xmlText).filter(Boolean).join(' ');
  return '';
}
const text = xmlText;

// ── JSON-LD JobPosting extraction ──────────────────────────────────

const JSONLD_REGEX = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Extract JSON-LD blocks from HTML string. */
export function extractJsonLdBlocks(html) {
  const blocks = [];
  if (!html) return blocks;
  let m;
  while ((m = JSONLD_REGEX.exec(html)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      blocks.push(parsed);
    } catch {
      // Some sites HTML-encode JSON; try one decode pass
      try { blocks.push(JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))); } catch { /* skip */ }
    }
  }
  return blocks;
}

/** Walk JSON-LD blocks and return only schema.org/JobPosting entries. */
export function findJobPostings(blocks) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object') return;
    const types = [].concat(node['@type'] || []);
    if (types.includes('JobPosting')) out.push(node);
    if (node['@graph']) visit(node['@graph']);
  };
  blocks.forEach(visit);
  return out;
}

/** Map a schema.org JobPosting object to our partial Job shape. */
export function jobPostingToPartial(jp, { source = 'jsonld', source_kind = 'jsonld' } = {}) {
  const org = jp.hiringOrganization || {};
  const loc = []
    .concat(jp.jobLocation || [])
    .map((l) => l?.address?.addressLocality || l?.address?.addressRegion || l?.address?.addressCountry || '')
    .filter(Boolean)
    .join(', ');
  const sal = jp.baseSalary?.value || jp.baseSalary || {};
  const currency = jp.baseSalary?.currency || sal.currency || null;
  const isRemote = jp.jobLocationType === 'TELECOMMUTE'
    || (jp.applicantLocationRequirements != null)
    || REMOTE_REGEX.test(`${jp.title || ''} ${stripHtml(jp.description || '')}`);

  return {
    source, source_kind,
    url: jp.url || jp.directApply || '',
    title: jp.title || '',
    company: typeof org === 'string' ? org : (org.name || ''),
    location: loc,
    description: jp.description || '',
    posted_at: jp.datePosted || null,
    expires_at: jp.validThrough || null,
    employment_type: Array.isArray(jp.employmentType) ? jp.employmentType[0] : (jp.employmentType || null),
    salary_min: numOrNull(sal.minValue ?? sal.value),
    salary_max: numOrNull(sal.maxValue ?? sal.value),
    salary_currency: currency,
    remote: isRemote,
    raw: jp,
  };
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

export function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Employment-type normalization ──────────────────────────────────

const EMPLOYMENT_TYPES = new Set([
  'FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'CONTRACT', 'TEMPORARY',
  'INTERN', 'INTERNSHIP', 'VOLUNTEER', 'PER_DIEM', 'OTHER',
]);

/**
 * Normalize a free-form employment type string into one of the known enum
 * values used in `Job.employment_type`. Returns null when the input is empty
 * or unrecognized rather than passing junk through.
 */
export function validateEmploymentType(input) {
  if (!input) return null;
  const upper = String(input).toUpperCase().replace(/[\s-]+/g, '_');
  if (EMPLOYMENT_TYPES.has(upper)) return upper;
  if (/FULL.?TIME/.test(upper)) return 'FULL_TIME';
  if (/PART.?TIME/.test(upper)) return 'PART_TIME';
  if (/CONTRACT/.test(upper)) return 'CONTRACTOR';
  if (/INTERN/.test(upper)) return 'INTERN';
  if (/TEMP/.test(upper)) return 'TEMPORARY';
  if (/VOLUNT/.test(upper)) return 'VOLUNTEER';
  return null;
}

// ── Title filter ───────────────────────────────────────────────────

/**
 * Build a title filter from { positive: [...], negative: [...] }.
 * Returns a predicate (title) -> boolean. Empty positive list = match all.
 */
export function buildTitleFilter(filter) {
  const pos = (filter?.positive || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const neg = (filter?.negative || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  return (title) => {
    if (!title) return false;
    const t = String(title).toLowerCase();
    const okPos = pos.length === 0 || pos.some((k) => t.includes(k));
    const okNeg = !neg.some((k) => t.includes(k));
    return okPos && okNeg;
  };
}

// ── Convenience: chunked parallel runner ───────────────────────────

export async function pAllLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await fn(items[idx], idx) }; }
      catch (err) { results[idx] = { ok: false, error: err }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Slugs ──────────────────────────────────────────────────────────

export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Type for documentation ─────────────────────────────────────────

/**
 * @typedef {object} Job
 * @property {string} source           Adapter id (e.g. "remotive")
 * @property {string} source_kind      api|rss|sitemap|jsonld|ats|scrape
 * @property {string} url              Canonical (deduped) URL
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {boolean} remote
 * @property {string[]} region         Tags like "pakistan","gulf","worldwide-remote"
 * @property {string|null} description
 * @property {number|null} salary_min
 * @property {number|null} salary_max
 * @property {string|null} salary_currency
 * @property {string|null} employment_type
 * @property {string|null} posted_at   ISO-8601 string
 * @property {string|null} expires_at
 * @property {string[]} tags
 * @property {string} apply_url
 * @property {*} raw                   Original payload for debugging
 */

/**
 * @typedef {object} AdapterMeta
 * @property {string} id
 * @property {'api'|'rss'|'sitemap'|'jsonld'|'ats'|'scrape'} kind
 * @property {string[]} regions          Static region tags this source covers
 * @property {{queries?:boolean,locations?:boolean,categories?:boolean,countries?:boolean}} supports
 * @property {{queries?:string[],locations?:string[],categories?:string[],countries?:string[]}} presets
 *           Known values surfaced to the UI as quick-select chips. Users may also
 *           type free-text values; adapters MUST accept arbitrary strings.
 * @property {object} schema             JSON-Schema-ish description of expected config
 * @property {boolean} [requiresKey]
 * @property {string} [docs]
 */

/**
 * @typedef {object} AdapterContext
 * @property {RateLimiter} rateLimiter
 * @property {CircuitBreaker} breaker
 * @property {(level: 'info'|'warn'|'error', msg: string, extra?: object) => void} log
 * @property {AbortSignal} [signal]
 */
