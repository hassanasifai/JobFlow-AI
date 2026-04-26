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
import { Briefcase, ExternalLink, MapPin, Building2, AlertTriangle, Sparkles } from 'lucide-react';
import { JobsFilterBar } from '@/components/jobs-filter-bar';
import { useDebounce } from '@/hooks/use-debounce';
import { useFilterUrlState } from '@/hooks/use-filter-url-state';
import { regionLabel, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { JobDetailDrawer, useJobDetailUrlState } from '@/components/job-detail-drawer';
import { NumberTicker } from '@/components/ui/number-ticker';

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
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/30 to-brand-violet/30 ring-1 ring-inset ring-primary/30">
            <Briefcase className="h-4 w-4 text-primary" />
          </span>
          Jobs
          {!jobsQuery.isLoading && total > 0 && (
            <span className="text-sm font-normal text-muted-foreground tabular-nums ml-2">
              <NumberTicker value={total} /> matches
            </span>
          )}
        </h1>
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
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative mx-3 my-1.5 w-[calc(100%-1.5rem)] text-left rounded-xl',
        'border border-border/50 bg-card/60 px-4 py-3 transition-all duration-200',
        'hover:border-primary/40 hover:bg-card hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.25)] hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      {/* Left edge accent — fades in on hover */}
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {job.title}
            </span>
            {job.remote_scope && job.remote_scope !== 'none' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border border-primary/20">
                {remoteScopeLabel(job.remote_scope)}
              </Badge>
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
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Briefcase className="h-3.5 w-3.5" />
              {job.source}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {job.region_group && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{regionLabel(job.region_group)}</Badge>
            )}
            {job.posted_at && (
              <span className="text-[11px] text-muted-foreground">
                Posted {relativeTime(job.posted_at)}
              </span>
            )}
          </div>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <a href={job.apply_url || job.url} target="_blank" rel="noopener noreferrer">
            Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </button>
  );
}

// Suppress unused-import warning for components that may be removed during polish.
void Card;
void Sparkles;

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
