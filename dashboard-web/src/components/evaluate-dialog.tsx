'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Job, streamAgent, StreamEvent } from '@/lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, AlertTriangle, Square, FileText } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { MarkdownView } from '@/components/markdown-view';
import { toast } from 'sonner';

type Endpoint = '/api/evaluate' | '/api/deep-research' | '/api/contacto';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' },
];

/**
 * Generic streaming dialog used by the Job Detail Drawer's Evaluate button.
 * Wraps `streamAgent()` and renders the live token stream as it arrives,
 * then offers a "Open report" CTA when a report file was saved.
 *
 * Reusable for any SSE endpoint by passing `endpoint` + `body` + `title`.
 */
export function EvaluateDialog({
  open,
  onOpenChange,
  job,
  endpoint = '/api/evaluate',
  title = 'Run full A–G evaluation',
  description = 'Streams the agent’s response in real time and saves a report when done.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  endpoint?: Endpoint;
  title?: string;
  description?: string;
}) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [language, setLanguage] = useState('en');
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [done, setDone] = useState<{
    reportPath: string | null;
    company: string;
    role: string;
    score: number | null;
    durationMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Editable JD text — seeded from job.description, but the user can paste a
  // full JD here when the scanner only captured the title/location.
  const [jdText, setJdText] = useState('');
  const acRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  // Reset every open. Dialogs in React get nasty without this.
  useEffect(() => {
    if (!open) {
      acRef.current?.abort();
      setRunning(false);
      setText('');
      setDone(null);
      setError(null);
      return;
    }
    // Seed the JD textarea with whatever the job already has.
    if (job) {
      const initial = job.description_html || job.description ||
        [job.title, job.company, job.location].filter(Boolean).join('\n');
      setJdText(initial || '');
    }
  }, [open, job]);

  const start = async () => {
    if (!job) return;
    if (!modelId) { toast.error('Pick a model first'); return; }
    if (jdText.trim().length < 40) {
      toast.error('Paste the full JD text first', {
        description: 'A scanner row alone (title + location) isn\'t enough context to evaluate. Use the textarea below.',
      });
      return;
    }
    setRunning(true);
    setText('');
    setDone(null);
    setError(null);
    const ac = new AbortController();
    acRef.current = ac;

    try {
      for await (const evt of streamAgent(endpoint, {
        jd_text: jdText,
        jd_url: job.url,
        company: job.company,
        role: job.title,
        model_id: modelId,
        language,
      }, { signal: ac.signal })) {
        handleEvent(evt);
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(String((err as Error)?.message || err));
      }
    } finally {
      setRunning(false);
    }
  };

  const handleEvent = (evt: StreamEvent) => {
    if (evt.type === 'token') {
      setText((prev) => prev + evt.chunk);
    } else if (evt.type === 'done' && 'summary' in evt) {
      // The "summary" key discriminates evaluate/deep/contacto's done shape
      // from CV Studio's done shape (which has html_path/pdf_path instead).
      // EvaluateDialog only ever consumes the former.
      const reportPath = evt.report_path;
      const summary = evt.summary;
      setDone({
        reportPath,
        company: summary?.company || job?.company || '—',
        role: summary?.role || job?.title || '—',
        score: summary?.score ?? null,
        durationMs: evt.duration_ms,
      });
      // The drawer's badge depends on overview; refresh.
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Evaluation complete', {
        description: summary?.score != null ? `Score: ${summary.score}/5` : undefined,
        action: reportPath ? {
          label: 'Open report',
          onClick: () => { window.location.href = `/dashboard/reports?path=${encodeURIComponent(reportPath)}`; },
        } : undefined,
      });
    } else if (evt.type === 'error') {
      setError(`${evt.message}${evt.hint ? ` — ${evt.hint}` : ''}`);
      toast.error(evt.message, { description: evt.hint });
    } else if (evt.type === 'warning') {
      toast.warning(evt.message);
    }
  };

  const stop = () => {
    acRef.current?.abort();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Model</Label>
            <ModelPicker value={modelId} onChange={setModelId} className="w-full" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Output language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!running && !text && !error && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="font-medium truncate">{job?.title}</div>
              <div className="text-xs text-muted-foreground truncate">{job?.company} · {job?.location}</div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="jd-text" className="text-xs flex items-center justify-between">
                <span>Job description</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{jdText.length} chars</span>
              </Label>
              <textarea
                id="jd-text"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="w-full min-h-[160px] resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Paste the JD here — the scanner usually only captures the title and location, so feed the model the full posting before evaluating."
                spellCheck={false}
              />
              {jdText.trim().length > 0 && jdText.trim().length < 40 && (
                <p className="text-[11px] text-amber-600">Need at least 40 chars to evaluate.</p>
              )}
            </div>
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t complete the run</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}

        {(running || text) && (
          <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
            <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex items-center gap-2">
              {running ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Streaming…</>
              ) : done ? (
                <><Sparkles className="h-3 w-3 text-emerald-500" /> Done in {(done.durationMs / 1000).toFixed(1)}s</>
              ) : null}
              {done?.score != null && <Badge variant="secondary" className="ml-auto">Score {done.score}/5</Badge>}
            </div>
            <ScrollArea className="flex-1 max-h-[55vh]">
              <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                {/* MarkdownView re-renders on every chunk — fine for this length */}
                <MarkdownView markdown={text || '_(awaiting first token…)_'} />
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex-row gap-2 flex-wrap">
          {done?.reportPath && (
            <Button asChild variant="outline" className="gap-1.5">
              <Link href={`/dashboard/reports?path=${encodeURIComponent(done.reportPath)}`}>
                <FileText className="h-4 w-4" /> Open report
              </Link>
            </Button>
          )}
          {running ? (
            <Button onClick={stop} variant="destructive" className="gap-1.5">
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button onClick={start} disabled={!modelId} className="gap-1.5">
              <Sparkles className="h-4 w-4" /> {text ? 'Re-run' : 'Run'}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="ml-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
