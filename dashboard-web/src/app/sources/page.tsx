'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, SourceHealth } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import {
  Activity, AlertTriangle, Key, ExternalLink, BookOpen, CheckCircle2,
  PauseCircle, XCircle, MinusCircle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { relativeTime, statusColor, statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function SourcesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sources-health'],
    queryFn: api.sourcesHealth,
    refetchInterval: 30_000,                     // a slow heartbeat is fine
  });

  const probe = useMutation({
    mutationFn: api.sourcesProbe,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sources-health'] });
      const s = result.probe;
      if (s) {
        toast.success(
          `Probed ${s.total} sources in ${(s.duration_ms / 1000).toFixed(1)}s`,
          { description: `${s.ok} healthy · ${s.errored} errored · ${s.skipped} skipped` },
        );
      } else {
        toast.warning('Probe completed but returned no data', { description: result.stderr.slice(0, 200) });
      }
    },
    onError: (err: Error) => toast.error('Probe failed', { description: err.message }),
  });

  const probedAt = data?.find((s) => s.probed_at)?.probed_at;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Sources health
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-provider status, last seen, and error reasons. Updated automatically every 30 s.
            {probedAt && (
              <span className="ml-1.5">Last probe: {relativeTime(probedAt)}.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => probe.mutate()}
          disabled={probe.isPending}
          aria-label="Probe sources now"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', probe.isPending && 'animate-spin')} />
          {probe.isPending ? 'Probing…' : 'Probe sources now'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load source health</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {isLoading ? <HealthSkeleton /> : <HealthGrid sources={data || []} />}
    </div>
  );
}

function HealthGrid({ sources }: { sources: SourceHealth[] }) {
  // Sort: healthy → stale → unknown → needs_inputs → needs_config → error → unavailable.
  const order = ['healthy', 'stale', 'unknown', 'needs_inputs', 'needs_config', 'error', 'unavailable'];
  const sorted = [...sources].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.id.localeCompare(b.id));

  const summary = {
    healthy: sources.filter((s) => s.status === 'healthy').length,
    stale: sources.filter((s) => s.status === 'stale').length,
    needs_inputs: sources.filter((s) => s.status === 'needs_inputs').length,
    needs_config: sources.filter((s) => s.status === 'needs_config').length,
    unavailable: sources.filter((s) => s.status === 'unavailable').length,
    error: sources.filter((s) => s.status === 'error').length,
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <SummaryCard label="Healthy" count={summary.healthy} status="healthy" icon={CheckCircle2} />
        <SummaryCard label="Stale" count={summary.stale} status="stale" icon={PauseCircle} />
        <SummaryCard label="Needs companies" count={summary.needs_inputs} status="needs_inputs" icon={Key} />
        <SummaryCard label="Needs key" count={summary.needs_config} status="needs_config" icon={Key} />
        <SummaryCard label="Unavailable" count={summary.unavailable} status="unavailable" icon={MinusCircle} />
        <SummaryCard label="Errors" count={summary.error} status="error" icon={XCircle} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((s) => <SourceCard key={s.id} source={s} />)}
      </div>
    </>
  );
}

function SummaryCard({
  label, count, status, icon: Icon,
}: {
  label: string;
  count: number;
  status: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={cn('h-8 w-8 rounded-md grid place-items-center text-white', statusColor(status))}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-2xl font-semibold leading-none">{count}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function SourceCard({ source }: { source: SourceHealth }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate flex items-center gap-2">
              {source.id}
              <span className={cn('h-2 w-2 rounded-full', statusColor(source.status))} aria-hidden />
            </CardTitle>
            <CardDescription className="text-xs flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{source.kind}</Badge>
              <span>{statusLabel(source.status)}</span>
            </CardDescription>
          </div>
          {source.docs && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={source.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  aria-label="Provider docs"
                >
                  <BookOpen className="h-4 w-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent>API docs</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3 space-y-2">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Total jobs" value={source.total.toLocaleString()} />
          <Stat label="Last 7 days" value={source.jobs_7d.toLocaleString()} />
        </div>
        <div className="text-xs text-muted-foreground">
          Last seen: {source.last_seen_at ? relativeTime(source.last_seen_at) : 'never'}
        </div>
        {source.probe_sample && (
          <div className="text-xs space-y-0.5 border-t border-border/50 mt-2 pt-2">
            <div className="text-muted-foreground">Latest probe sample:</div>
            <a
              href={source.probe_sample.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline inline-flex items-center gap-1 line-clamp-1"
            >
              {source.probe_sample.title}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            {(source.probe_sample.company || source.probe_sample.location) && (
              <div className="text-muted-foreground line-clamp-1">
                {[source.probe_sample.company, source.probe_sample.location].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        )}
        {source.regions.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {source.regions.slice(0, 5).map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px] px-1.5 py-0">{r}</Badge>
            ))}
          </div>
        )}
      </CardContent>
      {(source.last_error || source.missingEnv.length > 0 || source.missingInputs?.length > 0 || source.warning) && (
        <CardFooter className="flex flex-col items-start gap-2 pt-0">
          {source.missingEnv.length > 0 && (
            <Alert variant="default" className="py-2 text-xs space-y-1.5">
              <Key className="h-3 w-3" />
              <AlertDescription className="space-y-1.5">
                <div>
                  Add to <code className="font-mono">.env</code>: <code className="font-mono">{source.missingEnv.join(', ')}</code>
                </div>
                {source.freeTier && (
                  <div className="text-muted-foreground">{source.freeTier}</div>
                )}
                {source.signupUrl && (
                  <a
                    href={source.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    Get a free key →
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}
          {source.missingInputs?.length > 0 && (
            <Alert variant="default" className="py-2 text-xs">
              <Key className="h-3 w-3" />
              <AlertDescription>
                Configure <code className="font-mono">{source.missingInputs.join(', ')}</code> in <code className="font-mono">portals.yml</code> under <code className="font-mono">sources.{source.id}</code>.
              </AlertDescription>
            </Alert>
          )}
          {source.last_error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertTriangle className="h-3 w-3" />
              <AlertDescription>{source.last_error.error}</AlertDescription>
            </Alert>
          )}
          {source.warning && (
            <p className="text-xs text-muted-foreground italic">{source.warning}</p>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-4 space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
        </Card>
      ))}
    </div>
  );
}
