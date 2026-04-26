'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, Job } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Briefcase, ExternalLink, MapPin, Building2, AlertTriangle } from 'lucide-react';
import { JobsFilterBar } from '@/components/jobs-filter-bar';
import { useDebounce } from '@/hooks/use-debounce';
import { useFilterUrlState } from '@/hooks/use-filter-url-state';
import { regionLabel, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { JobDetailDrawer, useJobDetailUrlState } from '@/components/job-detail-drawer';

const PAGE_SIZE = 50;
const PAGE_LIMIT = 500;          // matches API_MAX

// Top-level component wraps in Suspense — useSearchParams requires it.
export function JobsList() {
  return (
    <Suspense fallback={<JobsSkeleton />}>
      <JobsListInner />
    </Suspense>
  );
}

function JobsListInner() {
  const [filter, updateFilter] = useFilterUrlState();
  const debouncedQ = useDebounce(filter.q, 250);
  const effective = useMemo(() => ({ ...filter, q: debouncedQ }), [filter, debouncedQ]);
  const [openJobUrl, setOpenJobUrl] = useJobDetailUrlState();

  // Adapter list for the source filter dropdown.
  const adaptersQuery = useQuery({
    queryKey: ['scanners'],
    queryFn: api.scanners,
    staleTime: 5 * 60_000,
  });

  const sourceOptions = useMemo(
    () => (adaptersQuery.data || []).map((a) => ({ id: a.id, label: a.id })),
    [adaptersQuery.data],
  );

  // Infinite query — page through /api/jobs with offset/limit. Total count is
  // returned with each page so we know when to stop.
  const jobsQuery = useInfiniteQuery({
    queryKey: ['jobs', effective],
    queryFn: ({ pageParam = 0 }) => api.jobs({
      region: effective.regions,
      source: effective.sources,
      q: effective.q || undefined,
      sinceDays: effective.sinceDays,
      remote: effective.remote,
      limit: Math.min(PAGE_SIZE, PAGE_LIMIT),
      offset: pageParam,
    }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });

  const flat = useMemo<Job[]>(
    () => jobsQuery.data?.pages.flatMap((p) => p.items) || [],
    [jobsQuery.data?.pages],
  );
  const total = jobsQuery.data?.pages[0]?.total ?? 0;

  // Virtualize the list — only the visible rows + a small overscan render.
  // Crucial when 1.8k jobs land in one filter; without this scroll lags.
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: jobsQuery.hasNextPage ? flat.length + 1 : flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 6,
  });

  // Auto-fetch the next page when the sentinel row scrolls into view.
  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems();
    const last = items[items.length - 1];
    if (!last) return;
    if (last.index >= flat.length - 1 && jobsQuery.hasNextPage && !jobsQuery.isFetchingNextPage) {
      jobsQuery.fetchNextPage();
    }
  }, [rowVirtualizer.getVirtualItems(), flat.length, jobsQuery]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">Listings collected by your last scan, deduped across providers.</p>
      </div>

      <JobsFilterBar
        value={filter}
        onChange={updateFilter}
        sourceOptions={sourceOptions}
        total={jobsQuery.isLoading ? undefined : total}
      />

      {jobsQuery.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load jobs</AlertTitle>
          <AlertDescription>{(jobsQuery.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {jobsQuery.isLoading ? (
        <JobsSkeleton />
      ) : flat.length === 0 && !jobsQuery.isFetching ? (
        <EmptyState />
      ) : (
        <div
          ref={parentRef}
          className="border rounded-lg bg-card overflow-y-auto"
          style={{ height: 'calc(100vh - 280px)' }}
        >
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((row) => {
              const job = flat[row.index];
              if (!job) {
                return (
                  <div key={row.key} style={virtualRowStyle(row)}>
                    <div className="px-4 py-6 text-sm text-muted-foreground">Loading more…</div>
                  </div>
                );
              }
              return (
                <div key={row.key} style={virtualRowStyle(row)}>
                  <JobRow job={job} onOpen={() => setOpenJobUrl(job.url)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <JobDetailDrawer
        url={openJobUrl}
        onClose={() => setOpenJobUrl(null)}
        // The drawer needs the visible job list as its lookup table — fetching
        // a single job by URL would require a new endpoint. Reusing what's
        // already paginated keeps the API surface small.
        candidates={flat}
      />
    </div>
  );
}

function virtualRowStyle(row: { start: number; size: number }) {
  return {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${row.start}px)`,
    height: row.size,
  };
}

function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  return (
    <Card
      className="mx-3 my-2 px-4 py-3 hover:shadow-md transition-shadow border-muted/60 cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="font-medium text-foreground hover:text-primary hover:underline truncate text-left"
            >
              {job.title}
            </button>
            {job.remote_scope && job.remote_scope !== 'none' && (
              <Badge variant="secondary" className="text-xs">{remoteScopeLabel(job.remote_scope)}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              {job.company}
            </span>
            {job.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {job.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              {job.source}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {job.region_group && (
              <Badge variant="outline" className="text-xs">{regionLabel(job.region_group)}</Badge>
            )}
            {job.posted_at && (
              <span className="text-xs text-muted-foreground">
                Posted {relativeTime(job.posted_at)}
              </span>
            )}
          </div>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <a href={job.apply_url || job.url} target="_blank" rel="noopener noreferrer">
            Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </Card>
  );
}

function remoteScopeLabel(s: string): string {
  switch (s) {
    case 'worldwide': return 'Remote · worldwide';
    case 'region': return 'Remote · region';
    case 'country': return 'Remote · country';
    default: return 'Remote';
  }
}

function JobsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className={cn('px-4 py-3 space-y-2 border-muted/40')}>
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-20" />
        </Card>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="px-8 py-16 text-center space-y-2 border-dashed">
      <Briefcase className="h-10 w-10 mx-auto text-muted-foreground" />
      <div className="text-base font-medium">No jobs yet</div>
      <div className="text-sm text-muted-foreground max-w-md mx-auto">
        Click <strong>Scan now</strong> in the top-right to fetch listings, or run
        <code className="mx-1 px-1.5 py-0.5 rounded bg-muted font-mono text-xs">node scan.mjs --all-free --region pakistan,gcc,remote</code>
        from the project root.
      </div>
    </Card>
  );
}
