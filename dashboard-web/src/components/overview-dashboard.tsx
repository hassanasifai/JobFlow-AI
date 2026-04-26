'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'motion/react';
import { api, Overview, ApplicationRow, ReportFile } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { Spotlight } from '@/components/ui/spotlight';
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern';
import { NumberTicker } from '@/components/ui/number-ticker';
import { MagicCard } from '@/components/ui/magic-card';
import { ScoreRing } from '@/components/ui/score-ring';
import {
  CheckCircle2, XCircle, AlertTriangle, ClipboardList, FilePlus2, Star,
  FileText, FileDown, Plus, ExternalLink, ArrowRight, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/format';
import { ScanNowDialog } from '@/components/scan-now-dialog';
import { fadeUp, stagger, spring } from '@/lib/motion';

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
      <Hero generatedAt={data?.generatedAt} onScan={() => setScanOpen(true)} />

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

// ── Hero ───────────────────────────────────────────────────────────────

function Hero({ generatedAt, onScan }: { generatedAt: string | undefined; onScan: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 glass">
      <AnimatedGridPattern numSquares={24} maxOpacity={0.12} className="opacity-60" />
      <Spotlight />
      <div className="relative z-10 px-6 py-8 md:px-10 md:py-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            <Sparkles className="h-3 w-3" /> AI-driven · live scanning
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Welcome back to <span className="gradient-text">JobFlow AI</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {generatedAt
              ? `Workspace synced ${relativeTime(generatedAt)} · 35 sources online · ready when you are.`
              : 'Fetching workspace…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ShimmerButton onClick={onScan} className="h-10 gap-2">
            <Sparkles className="h-4 w-4" /> Scan now
          </ShimmerButton>
          <Button asChild variant="outline" size="lg" className="gap-2 border-border/70 backdrop-blur-sm">
            <Link href="/pipeline"><Plus className="h-4 w-4" /> Add URL</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Loaded ──────────────────────────────────────────────────────────────

function Loaded({ overview }: { overview: Overview }) {
  return (
    <>
      {!overview.setup.ready && <SetupAlert overview={overview} />}
      <SectionMetrics overview={overview} />
      <SectionStatus overview={overview} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

// ── Metric cards (animated bento) ──────────────────────────────────────

function SectionMetrics({ overview }: { overview: Overview }) {
  const m = overview.metrics;
  const cards: Array<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: number;
    suffix?: string;
    decimals?: number;
    href: string;
    accent: string;
  }> = [
    { icon: ClipboardList, label: 'Total applications', value: m.totalApplications, href: '/applications', accent: 'text-blue-500' },
    { icon: FilePlus2, label: 'Pending pipeline', value: m.pendingPipeline, href: '/pipeline', accent: 'text-amber-500' },
    { icon: Star, label: 'Avg score', value: m.avgScore, decimals: 1, href: '/applications', accent: 'text-violet-500' },
    { icon: FileText, label: 'Reports', value: m.totalReports, href: '/reports', accent: 'text-cyan-500' },
    { icon: FileDown, label: 'PDFs generated', value: m.withPdf, href: '/outputs', accent: 'text-emerald-500' },
  ];
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={stagger}
      className="grid grid-cols-2 md:grid-cols-5 gap-3"
    >
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <motion.div key={c.label} variants={fadeUp}>
            <Link href={c.href} className="block h-full">
              <MagicCard className="h-full p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className={cn('h-8 w-8 grid place-items-center rounded-lg bg-gradient-to-br from-muted to-muted/50', c.accent)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-semibold leading-none tabular-nums">
                    <NumberTicker value={c.value} decimalPlaces={c.decimals || 0} delayMs={i * 80} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 truncate">{c.label}</div>
                </div>
              </MagicCard>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ── Status funnel ───────────────────────────────────────────────────────

function SectionStatus({ overview }: { overview: Overview }) {
  const total = overview.metrics.totalApplications;
  const counts = overview.metrics.byStatus;
  const ordered = STATUS_ORDER
    .map((label) => ({ label, count: counts[label.toLowerCase()] || 0 }))
    .filter((x) => x.count > 0);
  if (total === 0) {
    return (
      <Card className="glass">
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
    <Card className="glass overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Application funnel</span>
          <span className="text-xs text-muted-foreground tabular-nums">{total} total</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-muted/40 ring-1 ring-inset ring-border/40">
          {ordered.map((s, idx) => (
            <motion.div
              key={s.label}
              initial={{ width: 0 }}
              animate={{ width: `${(s.count / total) * 100}%` }}
              transition={{ ...spring, delay: idx * 0.05 }}
              className={cn(STATUS_COLOR[s.label] || 'bg-zinc-400', 'relative')}
              title={`${s.label}: ${s.count}`}
            >
              <span className="absolute inset-0 bg-white/10" aria-hidden />
            </motion.div>
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
    <Card className="glass">
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
      <CardContent className="space-y-1">
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No applications yet.</p>
        ) : (
          applications.map((a) => (
            <Link
              key={a.number}
              href="/applications"
              className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/50 text-sm transition-colors"
            >
              <span className="text-xs text-muted-foreground tabular-nums w-8 group-hover:text-primary transition-colors">#{a.number}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.role}</div>
                <div className="text-xs text-muted-foreground truncate">{a.company} · {a.date}</div>
              </div>
              {a.score > 0 && <ScoreRing score={a.score} size={28} strokeWidth={3} showLabel={false} className="shrink-0" />}
              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{a.status || '—'}</Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SectionRecentReports({ reports }: { reports: ReportFile[] }) {
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Latest reports
          </CardTitle>
          <CardDescription>Newest first</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/reports" className="text-xs gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No reports yet.</p>
        ) : (
          reports.map((r) => (
            <Link
              key={r.path}
              href={`/reports?path=${encodeURIComponent(r.path)}`}
              className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/50 text-sm transition-colors"
            >
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
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
          <Card key={i} className="p-4"><Skeleton className="h-16 w-full" /></Card>
        ))}
      </div>
      <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-full" /></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
        <Card className="p-4 space-y-2"><Skeleton className="h-4 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
      </div>
    </>
  );
}
