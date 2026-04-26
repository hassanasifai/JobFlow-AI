'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, Overview, ApplicationRow, ReportFile } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, XCircle, AlertTriangle, ClipboardList, FilePlus2, Star,
  FileText, FileDown, Play, Plus, ExternalLink, ArrowRight, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/format';
import { ScanNowDialog } from '@/components/scan-now-dialog';

// Status → palette. Sorted by typical funnel order so stacked bars read left-to-right.
const STATUS_ORDER = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

const STATUS_COLOR: Record<string, string> = {
  Evaluated: 'bg-zinc-400',
  Applied: 'bg-blue-500',
  Responded: 'bg-cyan-500',
  Interview: 'bg-violet-500',
  Offer: 'bg-emerald-500',
  Rejected: 'bg-red-500',
  Discarded: 'bg-zinc-500',
  SKIP: 'bg-zinc-300',
};

export function OverviewDashboard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 60_000,
  });
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            {data?.generatedAt ? `Last refreshed ${relativeTime(data.generatedAt)}` : 'Fetching workspace…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setScanOpen(true)} className="gap-2">
            <Play className="h-4 w-4" /> Scan now
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/pipeline"><Plus className="h-4 w-4" /> Add URL</Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load overview</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {isLoading ? <OverviewSkeleton /> : data ? <Loaded overview={data} /> : null}

      <ScanNowDialog open={scanOpen} onOpenChange={setScanOpen} />
    </div>
  );
}

function Loaded({ overview }: { overview: Overview }) {
  return (
    <>
      {!overview.setup.ready && <SetupAlert overview={overview} />}
      <SectionMetrics overview={overview} />
      <SectionStatus overview={overview} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionRecentApplications applications={overview.applications.slice(0, 6)} />
        <SectionRecentReports reports={overview.reports.slice(0, 6)} />
      </div>
    </>
  );
}

// ── Setup checklist ────────────────────────────────────────────────────

function SetupAlert({ overview }: { overview: Overview }) {
  return (
    <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> Workspace not fully set up
        </CardTitle>
        <CardDescription>
          Open <Link href="/settings" className="underline">Settings</Link> to fix any missing files.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {overview.setup.checks.map((c) => (
          <div
            key={c.path}
            className={cn(
              'flex items-start gap-2 rounded-md p-2 text-sm',
              c.present ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'bg-red-50/50 dark:bg-red-950/20',
            )}
          >
            {c.present ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <code className="font-mono text-xs">{c.path}</code>
              {!c.present && <p className="text-xs text-muted-foreground mt-0.5">{c.fix}</p>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Metric cards ───────────────────────────────────────────────────────

function SectionMetrics({ overview }: { overview: Overview }) {
  const m = overview.metrics;
  const cards: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; href: string; tone: string }[] = [
    { icon: ClipboardList, label: 'Total applications', value: m.totalApplications, href: '/applications', tone: 'text-blue-500' },
    { icon: FilePlus2, label: 'Pending pipeline', value: m.pendingPipeline, href: '/pipeline', tone: 'text-amber-500' },
    { icon: Star, label: 'Avg score', value: m.avgScore.toFixed(1), href: '/applications', tone: 'text-violet-500' },
    { icon: FileText, label: 'Reports', value: m.totalReports, href: '/reports', tone: 'text-cyan-500' },
    { icon: FileDown, label: 'PDFs', value: m.withPdf, href: '/outputs', tone: 'text-emerald-500' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.label} href={c.href}>
            <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full">
              <div className="flex items-center gap-3">
                <Icon className={cn('h-5 w-5 flex-shrink-0', c.tone)} />
                <div className="min-w-0">
                  <div className="text-2xl font-semibold leading-none tabular-nums">{c.value}</div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">{c.label}</div>
                </div>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

// ── Status breakdown ───────────────────────────────────────────────────

function SectionStatus({ overview }: { overview: Overview }) {
  const total = overview.metrics.totalApplications;
  const counts = overview.metrics.byStatus;
  const ordered = STATUS_ORDER
    .map((label) => ({ label, count: counts[label.toLowerCase()] || 0 }))
    .filter((x) => x.count > 0);
  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No applications yet. Save a job from the Jobs page or add a URL to the pipeline.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Application funnel</span>
          <span className="text-xs text-muted-foreground">{total} total</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-muted">
          {ordered.map((s) => (
            <div
              key={s.label}
              className={STATUS_COLOR[s.label] || 'bg-zinc-400'}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.label}: ${s.count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {ordered.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[s.label] || 'bg-zinc-400')} />
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground tabular-nums">{s.count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Recent activity ────────────────────────────────────────────────────

function SectionRecentApplications({ applications }: { applications: ApplicationRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Recent applications</CardTitle>
          <CardDescription>Last 6 entries</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/applications" className="text-xs gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No applications yet.</p>
        ) : (
          applications.map((a) => (
            <Link
              key={a.number}
              href="/applications"
              className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted text-sm"
            >
              <span className="text-xs text-muted-foreground tabular-nums w-8">#{a.number}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.role}</div>
                <div className="text-xs text-muted-foreground truncate">{a.company} · {a.date}</div>
              </div>
              <Badge variant="outline" className="text-[10px] px-1.5">{a.status || '—'}</Badge>
              {a.score > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5">{a.scoreRaw}</Badge>
              )}
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SectionRecentReports({ reports }: { reports: ReportFile[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-primary" /> Latest reports</CardTitle>
          <CardDescription>Newest first</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/reports" className="text-xs gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No reports yet.</p>
        ) : (
          reports.map((r) => (
            <Link
              key={r.path}
              href={`/reports?path=${encodeURIComponent(r.path)}`}
              className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted text-sm"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground">{relativeTime(r.modifiedAt)}</div>
              </div>
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-4"><Skeleton className="h-10 w-full" /></Card>
        ))}
      </div>
      <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-full" /></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
        <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
      </div>
    </>
  );
}
