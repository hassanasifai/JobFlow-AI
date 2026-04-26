'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, Overview } from '@/lib/api';

/**
 * Index Overview into URL/company-role lookup tables so the Jobs page can
 * quickly answer "is this URL already saved?" and "is this company+role
 * already in the tracker?" without scanning thousands of jobs every render.
 *
 * Cached on the same query key as Overview so Jobs and Apply share data.
 */
export function useOverviewLookup() {
  const overview = useQuery<Overview>({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 60_000,
    // The Jobs page polls /api/jobs aggressively; we don't want to also re-poll
    // /api/overview every keystroke. Once-a-minute is fine.
    refetchOnMount: false,
  });

  const lookup = useMemo(() => {
    const pipelineUrls = new Set<string>();
    const pipelineProcessed = new Set<string>();
    const companyRoleStatus = new Map<string, { number: number; status: string }>();

    if (overview.data) {
      for (const p of overview.data.pipelineItems.pending) pipelineUrls.add(canonicalUrl(p.url));
      for (const p of overview.data.pipelineItems.processed) {
        pipelineUrls.add(canonicalUrl(p.url));
        pipelineProcessed.add(canonicalUrl(p.url));
      }
      for (const a of overview.data.applications) {
        const key = `${a.company.trim().toLowerCase()}::${a.role.trim().toLowerCase()}`;
        // Latest write wins — applications.md is append-only so the largest
        // number is the most recent edit.
        const prev = companyRoleStatus.get(key);
        if (!prev || prev.number < a.number) {
          companyRoleStatus.set(key, { number: a.number, status: a.status || 'Evaluated' });
        }
      }
    }
    return { pipelineUrls, pipelineProcessed, companyRoleStatus };
  }, [overview.data]);

  return {
    overview: overview.data,
    isLoading: overview.isLoading,
    error: overview.error,
    lookup,
  };
}

/**
 * Light URL normalization for lookup parity with the backend dedup. Doesn't
 * have to be perfect — both sides need to use the same canonical form. We
 * lowercase the host, strip a `www.` prefix, and trim the trailing slash.
 */
function canonicalUrl(input: string): string {
  if (!input) return '';
  try {
    const u = new URL(input);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return input.trim();
  }
}

/** Look up the saved/applied state of a given job. Cheap memo-keyed lookup. */
export function jobState(
  job: { url: string; company: string; title: string },
  lookup: ReturnType<typeof useOverviewLookup>['lookup'],
): { saved: boolean; processed: boolean; applicationNumber: number | null; applicationStatus: string | null } {
  const url = canonicalUrl(job.url);
  const saved = lookup.pipelineUrls.has(url);
  const processed = lookup.pipelineProcessed.has(url);
  const key = `${(job.company || '').trim().toLowerCase()}::${(job.title || '').trim().toLowerCase()}`;
  const app = lookup.companyRoleStatus.get(key);
  return {
    saved,
    processed,
    applicationNumber: app?.number ?? null,
    applicationStatus: app?.status ?? null,
  };
}
