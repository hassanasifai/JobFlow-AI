// Smoke-renders every agent dialog in `open: true` to catch the most common
// regressions: a missing prop, a stale import, a runtime error during mount,
// a Radix portal that fails to attach in happy-dom. Each test is intentionally
// shallow — the goal is "this dialog opens without crashing", not interaction
// coverage. Detailed flow tests can come later if a specific dialog grows
// brittle behavior.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Job } from '@/lib/api';

import { ApplyDialog } from './apply-dialog';
import { EvaluateDialog } from './evaluate-dialog';
import { CvStudioDialog } from './cv-studio-dialog';
import { ScanNowDialog } from './scan-now-dialog';

// next/link is purely cosmetic in our dialogs (just a wrapper around <a>).
// Stub it to a passthrough so happy-dom doesn't choke on the App-Router
// internals.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'>) =>
    React.createElement('a', { href, ...rest }, children),
}));

// sonner uses portals + animation hooks that don't matter for a smoke test.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// next/navigation is imported transitively by some hooks. Stub the few
// methods our dialogs touch.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const FAKE_JOB: Job = {
  source: 'greenhouse',
  source_kind: 'ats',
  source_id: '1',
  title: 'Senior AI Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://example.com/jobs/1',
  remote: true,
  region_group: 'remote_worldwide',
};

// Default fetch stub. Some dialogs call /api/agents and /api/overview on
// mount via TanStack Query; without a stub the queries reject and React
// re-renders for a long time. Returning sensible empty payloads short-circuits
// that.
const FETCH_RESPONSES: Record<string, unknown> = {
  '/api/agents': [],
  '/api/overview': {
    setup: { ready: true, checks: [] },
    metrics: { total: 0, withPdf: 0, byStatus: {} },
    pipeline: { pending: 0, processed: 0 },
  },
  '/api/scanners': [],
};

function withProviders(ui: React.ReactElement) {
  // Per-test query client so failing one test doesn't poison the cache for
  // the next.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [path, body] of Object.entries(FETCH_RESPONSES)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('agent dialog smoke renders', () => {
  it('ApplyDialog opens and shows its heading', () => {
    withProviders(<ApplyDialog open={true} onOpenChange={() => {}} job={FAKE_JOB} />);
    // Apply dialog title varies but always contains "Apply" or job title.
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
  });

  it('EvaluateDialog opens and shows its sparkles header', () => {
    withProviders(<EvaluateDialog open={true} onOpenChange={() => {}} job={FAKE_JOB} />);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // The default title prop is "Run full A–G evaluation".
    expect(screen.getByText(/A–G evaluation/i)).toBeInTheDocument();
  });

  it('CvStudioDialog opens and exposes the paper-size + language pickers', () => {
    withProviders(<CvStudioDialog open={true} onOpenChange={() => {}} job={FAKE_JOB} />);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // Stage labels (Tailor CV / Render HTML / Generate PDF) only render once
    // a run is in progress; in idle state we instead expose form controls.
    expect(screen.getByText(/Paper/i)).toBeInTheDocument();
    expect(screen.getByText(/Language/i)).toBeInTheDocument();
  });

  it('ScanNowDialog opens and exposes the since-days time-window picker', () => {
    withProviders(<ScanNowDialog open={true} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // The since-days picker is the new feature shipped this session — make
    // sure it's actually rendered, not silently dropped by a refactor.
    expect(screen.getByText(/Time window|Posted/i)).toBeInTheDocument();
  });
});
