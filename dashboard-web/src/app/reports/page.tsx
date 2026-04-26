'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { api, ReportFile } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, Search, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/markdown-view';
import { relativeTime } from '@/lib/format';

export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
      <ReportsBrowser />
    </Suspense>
  );
}

function ReportsBrowser() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState('');

  const reports = overview.data?.reports || [];
  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return reports;
    return reports.filter((r) => r.name.toLowerCase().includes(ql) || r.path.toLowerCase().includes(ql));
  }, [reports, q]);

  const selectedPath = searchParams?.get('path') || filtered[0]?.path || null;
  const selected = reports.find((r) => r.path === selectedPath) || null;

  // Auto-select the first report if URL has none.
  useEffect(() => {
    if (!searchParams?.get('path') && filtered[0]?.path) {
      const params = new URLSearchParams(searchParams ?? new URLSearchParams());
      params.set('path', filtered[0].path);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [filtered, searchParams, router, pathname]);

  return (
    <div className="space-y-5 h-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Markdown evaluation reports under <code className="text-xs px-1 rounded bg-muted">reports/</code>.
        </p>
      </div>

      {overview.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load reports</AlertTitle>
          <AlertDescription>{(overview.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[60vh]">
        <Card className="p-3 flex flex-col">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reports…"
              className="pl-9"
            />
          </div>
          <ScrollArea className="flex-1 h-[60vh]">
            {overview.isLoading && <ReportsListSkeleton />}
            {!overview.isLoading && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground italic px-2 py-3">No reports yet.</p>
            )}
            <div className="space-y-0.5">
              {filtered.map((r) => (
                <button
                  key={r.path}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams ?? new URLSearchParams());
                    params.set('path', r.path);
                    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                  }}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-muted',
                    selectedPath === r.path && 'bg-primary/10 text-primary',
                  )}
                >
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">{relativeTime(r.modifiedAt)}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </Card>

        <Card className="p-0 overflow-hidden">
          {selected ? (
            <ReportContent report={selected} />
          ) : (
            <div className="px-8 py-16 text-center text-sm text-muted-foreground border-dashed">
              Select a report on the left.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ReportContent({ report }: { report: ReportFile }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['report', report.path],
    queryFn: () => api.reportContent(report.path),
  });

  const meta = useMemo(() => extractMeta(data?.content || ''), [data?.content]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{report.name}</h2>
            <p className="text-xs text-muted-foreground">{relativeTime(report.modifiedAt)}</p>
          </div>
          {meta.url && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <a href={meta.url} target="_blank" rel="noopener noreferrer">
                Open JD <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
        {(meta.score || meta.legitimacy || meta.recommendation) && (
          <div className="flex flex-wrap gap-1.5">
            {meta.score && <Badge variant="secondary">Score: {meta.score}</Badge>}
            {meta.legitimacy && <Badge variant="outline">Legitimacy: {meta.legitimacy}</Badge>}
            {meta.recommendation && <Badge>{meta.recommendation}</Badge>}
          </div>
        )}
      </div>
      <Separator />
      <ScrollArea className="flex-1 h-[55vh]">
        <div className="px-6 py-5">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn&apos;t load report</AlertTitle>
              <AlertDescription>{(error as Error).message}</AlertDescription>
            </Alert>
          )}
          {data && <MarkdownView markdown={data.content} />}
        </div>
      </ScrollArea>
    </div>
  );
}

function extractMeta(markdown: string): {
  score: string | null;
  legitimacy: string | null;
  recommendation: string | null;
  url: string | null;
} {
  // Reports use a header block like "**Score:** 4.2/5", "**URL:** https://...".
  const grab = (label: RegExp) => {
    const m = markdown.match(label);
    return m ? m[1].trim() : null;
  };
  return {
    score: grab(/\*\*Score:\*\*\s*([^\n]+)/i),
    legitimacy: grab(/\*\*Legitimacy:\*\*\s*([^\n]+)/i),
    recommendation: grab(/\*\*(?:Recommendation|Verdict):\*\*\s*([^\n]+)/i),
    url: grab(/\*\*URL:\*\*\s*<?(https?:\/\/[^\s>]+)>?/i),
  };
}

function ReportsListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
