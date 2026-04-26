'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { JobsFilterState } from '@/components/jobs-filter-bar';
import { EMPTY_FILTER } from '@/components/jobs-filter-bar';

// Encoding rules (kept minimal so URLs stay readable):
//   q          → 'q'           (single value)
//   regions[]  → 'r'           (csv)
//   sources[]  → 's'           (csv)
//   sinceDays  → 'since'       (number)
//   remote     → 'remote'      ('true' | 'false')
//   selected job url → 'job'   (used by the detail drawer; preserved here so
//                              filter changes don't drop the open drawer)
//
// We only emit keys that differ from defaults so a "no-filter" URL stays clean.

function listFromParam(value: string | null): string[] {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function readFilters(params: URLSearchParams): JobsFilterState {
  const since = Number(params.get('since'));
  const remote = params.get('remote');
  return {
    q: params.get('q') || '',
    regions: listFromParam(params.get('r')),
    sources: listFromParam(params.get('s')),
    sinceDays: Number.isFinite(since) && since > 0 ? since : null,
    remote: remote === 'true' ? true : remote === 'false' ? false : null,
  };
}

function writeFilters(prev: URLSearchParams, next: JobsFilterState): URLSearchParams {
  const out = new URLSearchParams(prev);
  const set = (key: string, value: string | null) => {
    if (!value) out.delete(key);
    else out.set(key, value);
  };
  set('q', next.q || null);
  set('r', next.regions.length ? next.regions.join(',') : null);
  set('s', next.sources.length ? next.sources.join(',') : null);
  set('since', next.sinceDays ? String(next.sinceDays) : null);
  set('remote', next.remote === true ? 'true' : next.remote === false ? 'false' : null);
  return out;
}

/**
 * Reads JobsFilterState from the URL and writes back via `router.replace`
 * (no history entry — keeps the back button useful for actual navigations).
 *
 * Defensively memoizes so identical-equal filter objects survive across
 * re-renders, which matters for TanStack Query's queryKey stability.
 */
export function useFilterUrlState(): [JobsFilterState, (patch: Partial<JobsFilterState>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = useMemo<JobsFilterState>(
    () => readFilters(searchParams ?? new URLSearchParams()),
    [searchParams],
  );

  const update = useCallback(
    (patch: Partial<JobsFilterState>) => {
      const next: JobsFilterState = { ...EMPTY_FILTER, ...filter, ...patch };
      const params = writeFilters(searchParams ?? new URLSearchParams(), next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filter, searchParams, router, pathname],
  );

  return [filter, update];
}
