'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApplicationRow } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, ChartLine } from 'lucide-react';
import { STATUS_COLOR } from '@/lib/states';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Analytics page (Phase L9) — rendered from the existing applications/jobs
 * data. We don't pull recharts in for v1; a CSS-grid funnel + per-status
 * counts is enough to read at a glance.
 */
export default function AnalyticsPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });

  const apps = overview.data?.applications || [];
  const stages = useMemo(() => buildFunnel(apps), [apps]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ChartLine}
        title="Analytics"
        description="Application funnel, conversion rates, time-in-stage. Computed from your applications tracker."
      />

      {overview.isLoading && <Skeleton className="h-40 w-full" />}

      {!overview.isLoading && apps.length === 0 && (
        <Card className="px-8 py-16 text-center border-dashed">
          <CardTitle className="text-base">No applications yet</CardTitle>
          <CardDescription className="mt-2">Save a job and mark it Applied to start populating analytics.</CardDescription>
        </Card>
      )}

      {!overview.isLoading && apps.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Funnel</CardTitle>
              <CardDescription>{apps.length} total · {stages[0]?.count} starting</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {stages.map((s) => (
                <div key={s.status}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[s.status as keyof typeof STATUS_COLOR] || 'bg-zinc-400')} />
                      <span className="font-medium">{s.status}</span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">{s.count} · {s.pctStart}% of starting</div>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full transition-all', STATUS_COLOR[s.status as keyof typeof STATUS_COLOR] || 'bg-zinc-400')}
                      style={{ width: `${s.pctStart}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Score distribution</CardTitle></CardHeader>
            <CardContent>
              <ScoreHistogram apps={apps} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function buildFunnel(apps: ApplicationRow[]): { status: string; count: number; pctStart: number }[] {
  // Funnel ordering: Evaluated → Applied → Responded → Interview → Offer.
  // Each stage's count = number of applications that have reached AT LEAST
  // this stage. So a row at status=Interview counts in Evaluated, Applied,
  // Responded, AND Interview. Rejected/Discarded/SKIP don't appear (terminal
  // states orthogonal to the funnel).
  const funnelOrder = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer'];
  const indexOf = (status: string) => funnelOrder.indexOf(status);
  return funnelOrder.map((stage, i) => {
    const count = apps.filter((a) => {
      const si = indexOf(a.status);
      return si >= i;                          // reached this stage or later
    }).length;
    const start = apps.filter((a) => indexOf(a.status) >= 0).length || 1;
    return { status: stage, count, pctStart: Math.round((count / start) * 100) };
  });
}

function ScoreHistogram({ apps }: { apps: ApplicationRow[] }) {
  // Tuple type lets TS know each index is always present (no `| undefined`).
  const buckets: [number, number, number, number, number] = [0, 0, 0, 0, 0]; // <2, 2-3, 3-4, 4-4.5, 4.5+
  for (const a of apps) {
    if (a.score <= 0) continue;
    if (a.score < 2) buckets[0]++;
    else if (a.score < 3) buckets[1]++;
    else if (a.score < 4) buckets[2]++;
    else if (a.score < 4.5) buckets[3]++;
    else buckets[4]++;
  }
  const labels: [string, string, string, string, string] = ['< 2.0', '2.0–3.0', '3.0–4.0', '4.0–4.5', '4.5+'];
  const max = Math.max(1, ...buckets);
  return (
    <div className="space-y-1.5">
      {labels.map((l, i) => {
        const value = buckets[i as 0 | 1 | 2 | 3 | 4];
        return (
          <div key={l} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-muted-foreground">{l}</span>
            <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
            </div>
            <Badge variant="outline" className="w-10 justify-center text-[10px] tabular-nums">{value}</Badge>
          </div>
        );
      })}
    </div>
  );
}

