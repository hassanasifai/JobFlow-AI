'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Job, streamAgent, StreamEvent } from '@/lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileDown, Sparkles, Loader2, AlertTriangle, ExternalLink, CheckCircle2, Square,
} from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'tailoring' | 'rendering' | 'pdf' | 'done' | 'error';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'tailoring', label: 'Tailor CV' },
  { id: 'rendering', label: 'Render HTML' },
  { id: 'pdf', label: 'Generate PDF' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' },
];

/**
 * CV Studio — the killer feature. Runs the agent over `modes/pdf.md` +
 * `cv.md` + `templates/cv-template.html` to produce a tailored, ATS-clean
 * HTML that fills every {{PLACEHOLDER}}, then shells out to
 * `generate-pdf.mjs` for the PDF render.
 *
 * The dialog walks through 3 visible stages:
 *   1. Tailor CV     — agent generates the HTML (slowest; 30-90s on Gemini)
 *   2. Render HTML   — instant; we save the file
 *   3. Generate PDF  — Playwright renders + writes to output/
 *
 * On done: we show the file path, a preview link (opens via /assets/), and
 * we invalidate the overview query so the Outputs page reflects the new
 * file immediately.
 */
export function CvStudioDialog({
  open,
  onOpenChange,
  job,
  applicationNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  applicationNumber?: number;
}) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [language, setLanguage] = useState('en');
  const [paper, setPaper] = useState<'letter' | 'a4'>('a4');
  const [jdText, setJdText] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<{ message: string; hint?: string; preview?: string; stderr?: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<{
    htmlPath: string; pdfPath: string; sizeBytes: number; durationMs: number;
  } | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  // Reset on open. Seed JD textarea from job.description.
  useEffect(() => {
    if (!open) {
      acRef.current?.abort();
      setStage('idle');
      setChars(0);
      setError(null);
      setWarnings([]);
      setDone(null);
      return;
    }
    if (job) {
      const seed = job.description_html || job.description ||
        [job.title, job.company, job.location].filter(Boolean).join('\n');
      setJdText(seed || '');
    }
  }, [open, job]);

  const start = async () => {
    if (!job) return;
    if (!modelId) { toast.error('Pick a model first'); return; }
    if (jdText.trim().length < 40) {
      toast.error('Paste the full JD first', {
        description: 'A scanner row alone (title + location) isn\'t enough to tailor a CV. Use the textarea below.',
      });
      return;
    }
    setStage('tailoring');
    setChars(0);
    setError(null);
    setWarnings([]);
    setDone(null);

    const ac = new AbortController();
    acRef.current = ac;

    try {
      for await (const evt of streamAgent('/api/generate-cv', {
        jd_text: jdText,
        jd_url: job.url,
        company: job.company,
        role: job.title,
        model_id: modelId,
        language,
        paper,
        application_number: applicationNumber,
      }, { signal: ac.signal })) {
        handleEvent(evt);
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        setError({ message: String((err as Error)?.message || err) });
        setStage('error');
      }
    }
  };

  const handleEvent = (evt: StreamEvent) => {
    if (evt.type === 'stage') {
      setStage(evt.stage as Stage);
    } else if (evt.type === 'progress') {
      setChars(evt.chars);
    } else if (evt.type === 'done' && 'pdf_path' in evt) {
      setDone({
        htmlPath: evt.html_path,
        pdfPath: evt.pdf_path,
        sizeBytes: evt.size_bytes,
        durationMs: evt.duration_ms,
      });
      setStage('done');
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Tailored CV ready', {
        description: `${(evt.size_bytes / 1024).toFixed(1)} KB · ${evt.candidate}-${evt.company}`,
        action: { label: 'Open PDF', onClick: () => { window.open(`/assets/${evt.pdf_path}`, '_blank'); } },
      });
    } else if (evt.type === 'error') {
      setError({
        message: evt.message,
        hint: evt.hint,
        preview: evt.preview,
        stderr: evt.stderr,
      });
      setStage('error');
      toast.error(evt.message, { description: evt.hint });
    } else if (evt.type === 'warning') {
      setWarnings((prev) => [...prev, evt.message]);
    }
  };

  const stop = () => acRef.current?.abort();

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const stagePct = stage === 'done' ? 100 : stage === 'idle' || stage === 'error' ? 0 : Math.min(95, ((stageIndex + 0.5) / STAGES.length) * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-primary" />
            CV Studio — tailored for this role
          </DialogTitle>
          <DialogDescription>
            The agent reads <code className="text-xs">cv.md</code> + <code className="text-xs">modes/pdf.md</code> + the template, then injects keywords, reorders bullets, and fills every <code className="text-xs">{'{{PLACEHOLDER}}'}</code>. Output is an ATS-clean PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {/* Job context */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1">
            <div className="font-medium text-sm leading-tight truncate">{job?.title}</div>
            <div className="text-xs text-muted-foreground truncate">{job?.company} · {job?.location}</div>
            {applicationNumber && (
              <Badge variant="outline" className="text-[10px]">Linked to application #{applicationNumber}</Badge>
            )}
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-1">
              <Label className="text-xs">Model</Label>
              <ModelPicker value={modelId} onChange={setModelId} className="w-full" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Paper</Label>
              <Select value={paper} onValueChange={(v) => setPaper(v as 'letter' | 'a4')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4 (most countries)</SelectItem>
                  <SelectItem value="letter">US Letter (US/Canada)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* JD textarea */}
          <div className="space-y-1">
            <Label htmlFor="cv-jd" className="text-xs flex items-center justify-between">
              <span>Job description</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{jdText.length} chars</span>
            </Label>
            <textarea
              id="cv-jd"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              className="w-full min-h-[140px] resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Paste the full JD here. The agent extracts 15–20 keywords, injects them into the summary + competencies + bullets, and reorders by relevance."
              spellCheck={false}
              disabled={stage === 'tailoring' || stage === 'rendering' || stage === 'pdf'}
            />
            {jdText.trim().length > 0 && jdText.trim().length < 40 && (
              <p className="text-[11px] text-amber-600">Need at least 40 chars to tailor.</p>
            )}
          </div>

          {/* Progress strip */}
          {stage !== 'idle' && (
            <div className="space-y-2">
              <Progress value={stagePct} />
              <div className="grid grid-cols-3 gap-2 text-xs">
                {STAGES.map((s, i) => {
                  const reached = stageIndex >= i || stage === 'done';
                  const active = s.id === stage;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2 py-1.5',
                        reached ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted/40 text-muted-foreground',
                        active && stage !== 'done' && 'ring-2 ring-primary',
                      )}
                    >
                      {active && stage !== 'done' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : reached ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Square className="h-3 w-3" />
                      )}
                      {s.label}
                    </div>
                  );
                })}
              </div>
              {stage === 'tailoring' && chars > 0 && (
                <p className="text-[11px] text-muted-foreground">Receiving HTML… {chars.toLocaleString()} chars so far.</p>
              )}
            </div>
          )}

          {/* Warnings (e.g. unfilled placeholders) */}
          {warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">Heads up</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                {warnings.map((w, i) => <div key={i}>{w}</div>)}
              </AlertDescription>
            </Alert>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{error.message}</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                {error.hint && <p>{error.hint}</p>}
                {error.preview && (
                  <ScrollArea className="max-h-32 rounded-md bg-muted/30 p-2 mt-2 font-mono whitespace-pre-wrap">
                    {error.preview}
                  </ScrollArea>
                )}
                {error.stderr && (
                  <ScrollArea className="max-h-24 rounded-md bg-muted/30 p-2 mt-2 font-mono whitespace-pre-wrap">
                    {error.stderr}
                  </ScrollArea>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Done */}
          {done && (
            <Alert className="border-emerald-500/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <AlertTitle>Tailored CV ready</AlertTitle>
              <AlertDescription className="space-y-1.5 text-xs">
                <div><code>{done.pdfPath}</code> · {(done.sizeBytes / 1024).toFixed(1)} KB · {(done.durationMs / 1000).toFixed(1)}s</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`/assets/${done.pdfPath}`} target="_blank" rel="noopener noreferrer">
                      Open PDF <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="gap-1.5">
                    <a href={`/assets/${done.htmlPath}`} target="_blank" rel="noopener noreferrer">
                      View HTML <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 flex-wrap">
          {stage === 'tailoring' || stage === 'rendering' || stage === 'pdf' ? (
            <Button onClick={stop} variant="destructive" className="gap-1.5">
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button onClick={start} disabled={!modelId || jdText.trim().length < 40} className="gap-1.5">
              {stage === 'done' ? <><Sparkles className="h-4 w-4" /> Re-generate</> : <><FileDown className="h-4 w-4" /> Generate tailored CV</>}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="ml-auto">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
