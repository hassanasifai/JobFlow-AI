'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { api, streamAgent, ReportFile, StreamEvent } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Scale, Sparkles, AlertTriangle, Loader2, Square, FileText,
} from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { MarkdownView } from '@/components/markdown-view';
import { toast } from 'sonner';
import { relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Compare offers — surfaces modes/ofertas.md. The user picks 2–4 evaluation
 * reports from reports/, the agent loads each, runs the 10-dim weighted
 * scoring matrix, and outputs a final recommendation.
 *
 * The selection is preserved in URL params (?ids=p1,p2,p3) so the result is
 * shareable / bookmarkable.
 */
export default function ComparePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
      <CompareInner />
    </Suspense>
  );
}

function CompareInner() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const reports = overview.data?.reports || [];

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialIds = useMemo(() => (searchParams?.get('ids') || '').split(',').filter(Boolean), [searchParams]);
  const [selected, setSelected] = useState<string[]>(initialIds);
  const [modelId, setModelId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  // Sync selection to URL.
  useEffect(() => {
    const params = new URLSearchParams(searchParams ?? new URLSearchParams());
    if (selected.length) params.set('ids', selected.join(','));
    else params.delete('ids');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [selected, pathname, router, searchParams]);

  const toggle = (path: string) => {
    setSelected((prev) => prev.includes(path)
      ? prev.filter((p) => p !== path)
      : (prev.length >= 4 ? prev : [...prev, path]));
  };

  const start = async () => {
    if (selected.length < 2) { toast.error('Pick at least 2 reports'); return; }
    if (!modelId) { toast.error('Pick a model'); return; }
    setRunning(true);
    setText('');
    setError(null);
    const ac = new AbortController();
    acRef.current = ac;
    try {
      for await (const evt of streamAgent('/api/compare-offers', {
        report_paths: selected,
        model_id: modelId,
      }, { signal: ac.signal })) {
        handleEvent(evt);
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(String((e as Error)?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const handleEvent = (evt: StreamEvent) => {
    if (evt.type === 'token') setText((p) => p + evt.chunk);
    else if (evt.type === 'error') {
      setError(`${evt.message}${evt.hint ? ` — ${evt.hint}` : ''}`);
      toast.error(evt.message, { description: evt.hint });
    }
  };

  const stop = () => acRef.current?.abort();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Scale}
        title="Compare offers"
        description="Pick 2–4 evaluation reports. modes/ofertas.md scores them across 10 weighted dimensions and gives a final recommendation."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Pick reports</CardTitle>
          <CardDescription>{selected.length}/4 selected</CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          {overview.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-3 py-3">No reports yet. Run an evaluation first.</p>
          ) : (
            <ReportList reports={reports} selected={selected} onToggle={toggle} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">2. Compare</CardTitle>
            <CardDescription>Streams the comparison live</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <ModelPicker value={modelId} onChange={setModelId} className="w-[220px]" />
            {running ? (
              <Button onClick={stop} variant="destructive" size="sm" className="gap-1.5">
                <Square className="h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button onClick={start} disabled={selected.length < 2 || !modelId} className="gap-1.5">
                <Sparkles className="h-4 w-4" /> {text ? 'Re-run' : 'Compare'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn&apos;t compare</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
            </Alert>
          )}
          {(running || text) && (
            <div className="border rounded-md bg-muted/30 overflow-hidden">
              <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex items-center gap-2">
                {running ? (<><Loader2 className="h-3 w-3 animate-spin" /> Streaming…</>) : (<><Sparkles className="h-3 w-3 text-emerald-500" /> Done</>)}
              </div>
              <ScrollArea className="max-h-[60vh]">
                <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                  <MarkdownView markdown={text || '_(awaiting tokens…)_'} />
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportList({
  reports, selected, onToggle,
}: {
  reports: ReportFile[];
  selected: string[];
  onToggle: (path: string) => void;
}) {
  return (
    <div className="space-y-1">
      {reports.slice(0, 80).map((r) => {
        const checked = selected.includes(r.path);
        return (
          <label
            key={r.path}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-md hover:bg-muted/40 cursor-pointer text-sm"
          >
            <Checkbox checked={checked} onCheckedChange={() => onToggle(r.path)} />
            <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 truncate font-medium">{r.name}</span>
            <Badge variant="outline" className="text-[10px]">{relativeTime(r.modifiedAt)}</Badge>
          </label>
        );
      })}
    </div>
  );
}
