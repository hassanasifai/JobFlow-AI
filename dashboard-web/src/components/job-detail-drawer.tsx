'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ExternalLink, Building2, MapPin, Briefcase, Globe2, DollarSign, Clock, Sparkles,
  Loader2, AlertTriangle, FileText, BookmarkPlus, Activity, Send, Search, FileDown,
} from 'lucide-react';
import { api, Job } from '@/lib/api';
import { regionLabel, relativeTime } from '@/lib/format';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { toast } from 'sonner';
import { ApplyDialog } from '@/components/apply-dialog';
import { JobStateBadge } from '@/components/job-state-badge';
import { useOverviewLookup, jobState } from '@/hooks/use-overview-lookup';
import { EvaluateDialog } from '@/components/evaluate-dialog';
import { CvStudioDialog } from '@/components/cv-studio-dialog';

/**
 * Reads/writes the currently-open job URL into the `job` query param so
 * deep-linking works (paste a URL with ?job=…&r=pakistan and it opens the
 * drawer with the correct filter context). Returns a setter that uses
 * `router.replace` to avoid polluting history with every drawer open/close.
 */
export function useJobDetailUrlState(): [string | null, (url: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams?.get('job') || null;
  const setOpen = useCallback((url: string | null) => {
    const params = new URLSearchParams(searchParams ?? new URLSearchParams());
    if (url) params.set('job', url);
    else params.delete('job');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  return [open, setOpen];
}

export function JobDetailDrawer({
  url,
  onClose,
  candidates,
}: {
  url: string | null;
  onClose: () => void;
  candidates: Job[];
}) {
  // Find the job by its canonical URL inside the already-fetched list. If we
  // miss (e.g. user followed a deep-link before the matching page loaded),
  // fall back to a minimal placeholder so the drawer still renders the URL.
  const job = useMemo(() => {
    if (!url) return null;
    return candidates.find((j) => j.url === url) || null;
  }, [url, candidates]);

  return (
    <Sheet open={!!url} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {url && (
          <DrawerBody
            url={url}
            job={job}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  url,
  job,
  onClose,
}: {
  url: string;
  job: Job | null;
  onClose: () => void;
}) {
  const { lookup } = useOverviewLookup();
  const state = job ? jobState(job, lookup) : null;

  return (
    <>
      <SheetHeader className="px-6 py-4 border-b">
        {job ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <SheetTitle className="text-lg leading-tight">{job.title}</SheetTitle>
              {state && <JobStateBadge state={state} />}
            </div>
            <SheetDescription asChild>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>{job.company}</span>
              </div>
            </SheetDescription>
          </>
        ) : (
          <>
            <SheetTitle className="text-lg leading-tight">Job</SheetTitle>
            <SheetDescription className="text-sm break-all">
              {url}
            </SheetDescription>
          </>
        )}
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-4">
          {job ? <JobMeta job={job} /> : <NotInListAlert url={url} />}
          {job && <Separator />}
          {job && <JobDescription job={job} />}
          {job && <Separator />}
          {job && <GeminiEvalSection job={job} />}
        </div>
      </ScrollArea>

      <DrawerFooterActions url={url} job={job} onClose={onClose} />
    </>
  );
}

function DrawerFooterActions({
  url,
  job,
  onClose,
}: {
  url: string;
  job: Job | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [applyOpen, setApplyOpen] = useState(false);
  const [evaluateOpen, setEvaluateOpen] = useState(false);
  const [deepOpen, setDeepOpen] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);

  // Save-to-pipeline: lightweight triage that adds the URL to the inbox so
  // the user can come back later. The richer "I'm applying" path lives in
  // ApplyDialog and creates a tracker row directly.
  const save = useMutation({
    mutationFn: () => api.pipelineAdd({
      url: job?.url || url,
      company: job?.company,
      role: job?.title,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Saved to pipeline', {
        action: { label: 'Open', onClick: () => router.push('/dashboard/pipeline') },
      });
    },
    onError: (e: Error) => toast.error('Couldn\'t save', { description: e.message }),
  });

  const liveness = useMutation({
    mutationFn: () => api.liveness([job?.url || url]),
    onSuccess: (res) => {
      const out = (res.stdout || res.stderr || '').slice(0, 240);
      if (res.ok) toast.success('Liveness check ran', { description: out || 'See terminal for details.' });
      else toast.warning('Liveness check returned a non-zero exit', { description: out });
    },
    onError: (e: Error) => toast.error('Liveness check failed', { description: e.message }),
  });

  return (
    <>
      <div className="px-6 py-3 border-t flex flex-wrap items-center gap-2 bg-muted/30">
        <Button onClick={() => setEvaluateOpen(true)} disabled={!job} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Evaluate
        </Button>
        <Button onClick={() => setApplyOpen(true)} disabled={!job} variant="outline" className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> Apply
        </Button>
        <Button onClick={() => setDeepOpen(true)} disabled={!job} variant="outline" size="sm" className="gap-1.5">
          <Search className="h-3.5 w-3.5" /> Research
        </Button>
        <Button onClick={() => setCvOpen(true)} disabled={!job} variant="outline" size="sm" className="gap-1.5">
          <FileDown className="h-3.5 w-3.5" />
          Tailored CV
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={(job?.apply_url || url) ?? url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="gap-1.5"
          title="Save to pipeline"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => liveness.mutate()}
          disabled={liveness.isPending}
          className="gap-1.5"
          title="Liveness check"
        >
          {liveness.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
      </div>
      <ApplyDialog open={applyOpen} onOpenChange={setApplyOpen} job={job} />
      <EvaluateDialog
        open={evaluateOpen}
        onOpenChange={setEvaluateOpen}
        job={job}
        endpoint="/api/evaluate"
        title="Run full A–G evaluation"
        description="The agent reads cv.md + modes/oferta.md and scores every block live."
      />
      <EvaluateDialog
        open={deepOpen}
        onOpenChange={setDeepOpen}
        job={job}
        endpoint="/api/deep-research"
        title="Deep company research"
        description="Pulls everything modes/deep.md asks for: people, news, comp signals."
      />
      <CvStudioDialog open={cvOpen} onOpenChange={setCvOpen} job={job} />
    </>
  );
}

function JobMeta({ job }: { job: Job }) {
  const meta: Array<[React.ComponentType<{ className?: string }>, string, string | null | undefined]> = [
    [MapPin, 'Location', job.location || null],
    [Globe2, 'Region', job.region_group ? regionLabel(job.region_group) : null],
    [Briefcase, 'Source', job.source],
    [Clock, 'Posted', job.posted_at ? `${relativeTime(job.posted_at)} (${formatDate(job.posted_at)})` : null],
    [DollarSign, 'Salary', formatSalary(job)],
    [FileText, 'Type', job.employment_type ? prettyEnum(job.employment_type) : null],
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {job.remote_scope && job.remote_scope !== 'none' && (
          <Badge variant="default">Remote · {job.remote_scope}</Badge>
        )}
        {job.region_group && <Badge variant="secondary">{regionLabel(job.region_group)}</Badge>}
        {job.country_code && <Badge variant="outline">{job.country_code}</Badge>}
        {(job.tags || []).slice(0, 6).map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
        ))}
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm">
        {meta.map(([Icon, label, value]) => value ? (
          <div key={label} className="flex items-start gap-2">
            <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
            <dt className="w-20 flex-shrink-0 text-muted-foreground">{label}</dt>
            <dd className="font-medium min-w-0 break-words">{value}</dd>
          </div>
        ) : null)}
      </dl>
    </div>
  );
}

function NotInListAlert({ url }: { url: string }) {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Not in current view</AlertTitle>
      <AlertDescription className="text-xs">
        Couldn&apos;t find this job in the loaded list. Use the link below to view it directly.
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-1 break-all underline text-primary"
        >
          {url}
        </a>
      </AlertDescription>
    </Alert>
  );
}

function JobDescription({ job }: { job: Job }) {
  const [showFull, setShowFull] = useState(false);
  const raw = job.description_html || job.description || '';
  const isHtml = /<[a-z][\s\S]*>/i.test(raw);
  // DOMPurify sanitizes provider HTML inside the component so the result is
  // memoized per-job. Without this, scripts/event-handlers/iframes injected
  // by a hostile provider would execute via dangerouslySetInnerHTML. Hook
  // call lives at the top of the function (before any early return) to obey
  // React's rules-of-hooks.
  const safeHtml = useMemo(() => (isHtml ? sanitizeHtml(raw) : ''), [raw, isHtml]);

  if (!raw.trim()) return <p className="text-sm text-muted-foreground italic">No description available.</p>;

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Description</div>
      <div
        className={`prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed ${showFull ? '' : 'line-clamp-[14]'}`}
      >
        {isHtml ? (
          <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
        ) : (
          <pre className="whitespace-pre-wrap font-sans">{raw}</pre>
        )}
      </div>
      {!showFull && raw.length > 600 && (
        <Button variant="link" size="sm" className="px-0 mt-1" onClick={() => setShowFull(true)}>
          Show full description
        </Button>
      )}
    </div>
  );
}

function GeminiEvalSection({ job }: { job: Job }) {
  const text = useMemo(() => buildEvalPrompt(job), [job]);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const eval$ = useMutation({
    mutationFn: api.geminiEval,
    onSuccess: (res) => {
      const stdout = (res.stdout || '').trim();
      const stderr = (res.stderr || '').trim();
      if (!res.ok && stderr.length) {
        setWarning(stderr);
        toast.error('Gemini failed', { description: stderr.slice(0, 200) });
        return;
      }
      if (!stdout) {
        setWarning(stderr || 'Gemini returned no output. Check GEMINI_API_KEY in .env.');
        return;
      }
      setResult(stdout);
      setWarning(null);
    },
    onError: (e: Error) => {
      setWarning(e.message);
      toast.error('Gemini eval failed', { description: e.message });
    },
  });

  const tooShort = text.length < 20;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Gemini quick evaluation
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => eval$.mutate(text)}
          disabled={eval$.isPending || tooShort}
          className="gap-1.5"
        >
          {eval$.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {eval$.isPending ? 'Evaluating…' : result ? 'Re-evaluate' : 'Evaluate'}
        </Button>
      </div>
      {tooShort && (
        <p className="text-xs text-muted-foreground italic">
          Description is too short to evaluate. Need at least 20 characters.
        </p>
      )}
      {warning && !result && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t evaluate</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{warning}</AlertDescription>
        </Alert>
      )}
      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap leading-relaxed font-sans">
          {result}
        </div>
      )}
    </div>
  );
}

// Build the prompt-like payload Gemini eval expects. We send the full posting
// context so it has enough signal to produce an A–G block evaluation.
function buildEvalPrompt(job: Job): string {
  const parts = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    job.country_code && `Country: ${job.country_code}`,
    job.remote_scope && `Remote scope: ${job.remote_scope}`,
    formatSalary(job) && `Salary: ${formatSalary(job)}`,
    job.url && `URL: ${job.url}`,
    '',
    stripHtmlOnClient(job.description_html || job.description || ''),
  ].filter(Boolean);
  return parts.join('\n');
}

function stripHtmlOnClient(html: string): string {
  if (!html) return '';
  // Very small DOM-free strip — good enough for prompt input. The backend
  // already does the heavy parsing on the JD it receives.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSalary(job: Job): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const cur = job.salary_currency ? `${job.salary_currency} ` : '';
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `${cur}${job.salary_min.toLocaleString()}–${job.salary_max.toLocaleString()}`;
  }
  const v = job.salary_min || job.salary_max;
  return v ? `${cur}${v.toLocaleString()}` : null;
}

function prettyEnum(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}
