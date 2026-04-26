import type { NextConfig } from 'next';

// Two ways to ship this dashboard:
//
// 1. Dev / standalone — `next dev` or `next start` on its own port, with
//    /api/* proxied to web-server.mjs. We use this during iteration.
//
// 2. Static export — `next build` with `output: 'export'` produces a fully
//    static `out/` directory under /dashboard, which web-server.mjs serves
//    same-origin. No Next runtime needed in production. Set
//    CAREER_OPS_DASHBOARD_EXPORT=1 to enable.
//
// We toggle between modes with an env var so a single config covers both
// without committing two files.

const API_TARGET = process.env.CAREER_OPS_API_BASE || 'http://127.0.0.1:5177';
const isExport = process.env.CAREER_OPS_DASHBOARD_EXPORT === '1';

// Security headers applied to every route in dev/start mode. (For static
// export, web-server.mjs sets equivalent headers in commonHeaders().)
//
// CSP: Next 16 ships hydration script tags whose hashes change every build,
// so we allow 'unsafe-inline' for scripts under same-origin only. Tighter
// builds can switch to nonce-based CSP via middleware once that infra is in
// place. img-src includes data: for inline SVG icons (lucide-react).
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' " + API_TARGET,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  // HSTS only meaningful when actually served over HTTPS. Harmless in dev.
  { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
];

const nextConfig: NextConfig = isExport
  ? {
      output: 'export',
      basePath: '/dashboard',
      trailingSlash: true,
      // No `rewrites` — `output: 'export'` forbids them, and the host
      // (web-server.mjs) serves /api/* from the same origin in this mode.
      images: { unoptimized: true },
    }
  : {
      async rewrites() {
        return [
          { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
        ];
      },
      async headers() {
        return [{ source: '/:path*', headers: SECURITY_HEADERS }];
      },
    };

export default nextConfig;
