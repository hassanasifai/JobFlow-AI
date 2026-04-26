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
    };

export default nextConfig;
