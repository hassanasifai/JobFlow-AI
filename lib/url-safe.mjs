// lib/url-safe.mjs
// URL safety helpers — primarily SSRF defense. Rejects URLs that resolve to
// loopback, RFC 1918 private ranges, link-local, cloud metadata, or other
// non-public destinations. Used by fetchWithRetry and any HTTP handler that
// proxies user-supplied URLs.

import { lookup } from 'dns/promises';
import { isIP } from 'net';

const PRIVATE_V4_REGEX = [
  /^10\./,                              // 10.0.0.0/8
  /^127\./,                             // loopback
  /^169\.254\./,                        // link-local + cloud metadata (169.254.169.254 on AWS/GCE)
  /^172\.(1[6-9]|2\d|3[01])\./,         // 172.16.0.0/12
  /^192\.168\./,                        // 192.168.0.0/16
  /^0\./,                               // 0.0.0.0/8 — "this network"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 — CGNAT
  /^198\.1[89]\./,                      // 198.18.0.0/15 — benchmarking
  /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./, // TEST-NETs
];

const PRIVATE_V6_PREFIXES = [
  '::1',          // loopback
  'fe80:', 'fe81:', 'fe82:', 'fe83:', 'fe84:', 'fe85:', 'fe86:', 'fe87:',
  'fe88:', 'fe89:', 'fe8a:', 'fe8b:', 'fe8c:', 'fe8d:', 'fe8e:', 'fe8f:',
  'fe9', 'fea', 'feb', // link-local fe80::/10
  'fc', 'fd',     // ULA fc00::/7
  '::ffff:',      // IPv4-mapped — re-validate the v4 portion separately
];

/**
 * Returns true if `host` is a private/loopback/link-local/metadata address.
 * Accepts either an IP literal or a hostname (hostname triggers a DNS lookup).
 */
export async function isPrivateHost(host) {
  if (!host) return true;
  const lower = String(host).toLowerCase().replace(/^\[|\]$/g, '');

  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return true;
  }

  if (isIP(lower)) {
    return ipIsPrivate(lower);
  }

  try {
    const records = await lookup(lower, { all: true });
    if (!records || records.length === 0) return true;
    return records.some(({ address }) => ipIsPrivate(address));
  } catch {
    return true;
  }
}

function ipIsPrivate(ip) {
  if (isIP(ip) === 4) {
    return PRIVATE_V4_REGEX.some((re) => re.test(ip));
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) {
      const tail = lower.slice('::ffff:'.length);
      if (isIP(tail) === 4) return ipIsPrivate(tail);
    }
    return PRIVATE_V6_PREFIXES.some((p) => lower.startsWith(p));
  }
  return true;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Throws if `url` is not a public http(s) URL. Use at HTTP request boundaries
 * before calling fetch() with caller-influenced URLs.
 */
export async function assertPublicUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new SsrfError(`Invalid URL: ${truncate(url)}`);
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new SsrfError(`Disallowed protocol: ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new SsrfError('URL credentials are not allowed');
  }
  if (await isPrivateHost(u.hostname)) {
    throw new SsrfError(`Refusing to fetch private/loopback host: ${u.hostname}`);
  }
}

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.retriable = false;
  }
}

function truncate(s, n = 200) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}
