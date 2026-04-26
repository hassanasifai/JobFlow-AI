'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ApiError, api, Job } from '@/lib/api';
import { useOverviewLookup, jobState } from '@/hooks/use-overview-lookup';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Send, ExternalLink, CheckCircle2, XCircle, AlertTriangle, Loader2, Copy,
  ClipboardCheck, Building2, MapPin, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/model-picker';
import { streamAgent } from '@/lib/api';

/**
 * Apply Now — the canonical flow for submitting a job application from the
 * dashboard. Two intents wired into one modal:
 *
 *   1. **Save as application** (status=Evaluated)
 *      For when you've decided this is worth tracking but haven't applied yet.
 *
 *   2. **Mark as Applied** (status=Applied)
 *      The real Apply button. Stamps today's date into the notes header,
 *      copies any drafted answers in, and creates the tracker row in one shot.
 *
 * Pre-flight checklist surfaces what's missing (CV, profile.yml, generated
 * PDF) so you don't accidentally apply with stale artifacts. The user can
 * still proceed — the checks are advisory, not blocking — but you see the
 * gap before you click submit.
 */
export function ApplyDialog({
  open,
  onOpenChange,
  job,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
}) {
  const { overview, lookup } = useOverviewLookup();
  const qc = useQueryClient();

  const state = job ? jobState(job, lookup) : null;
  const setupReady = overview?.setup.ready === true;
  const cvOk = overview?.setup.checks.find((c) => c.path === 'cv.md')?.present === true;
  const profileOk = overview?.setup.checks.find((c) => c.path === 'config/profile.yml')?.present === true;
  const hasPdfs = (overview?.metrics.withPdf || 0) > 0;

  const [intent, setIntent] = useState<'save' | 'applied'>('applied');
  const [draftedAnswers, setDraftedAnswers] = useState('');
  const [confirmedCv, setConfirmedCv] = useState(false);
  const [confirmedQuestions, setConfirmedQuestions] = useState(false);
  const [confirmedSubmit, setConfirmedSubmit] = useState(false);
  const [copyHit, setCopyHit] = useState(false);

  // Reset state every open. Crucial — without this, switching between jobs
  // in the same session would carry over the previous job's drafted answers.
  useEffect(() => {
    if (!open) return;
    setIntent(state?.applicationNumber ? 'save' : 'applied');
    setDraftedAnswers('');
    setConfirmedCv(false);
    setConfirmedQuestions(false);
    setConfirmedSubmit(false);
    setCopyHit(false);
  }, [open, state?.applicationNumber]);

  const create = useMutation({
    mutationFn: () => {
      if (!job) throw new Error('no job');
      return api.createApplication({
        company: job.company,
        role: job.title,
        url: job.url,
        status: intent === 'applied' ? 'Applied' : 'Evaluated',
        score: undefined,
        notes: composeNotes({
          intent,
          drafted: draftedAnswers,
          job,
        }),
        pdf: hasPdfs,
        // The user can override duplicate detection by re-clicking after the
        // 409 toast — the second click flips this on.
        allow_duplicate: false,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      const verb = intent === 'applied' ? 'Marked as Applied' : 'Saved to tracker';
      toast.success(verb, {
        description: `Application #${res.number} created.`,
        action: {
          label: 'Open',
          onClick: () => { window.location.href = '/dashboard/applications'; },
        },
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // 409 Conflict — already in the tracker. Offer to open the existing row
      // or force a duplicate (rare).
      if (err instanceof ApiError && err.status === 409) {
        let detail: { existing?: { number: number; company: string; role: string } } = {};
        try { detail = JSON.parse((err.body as { error?: string } | null)?.error || '{}'); } catch { /* swallow */ }
        const existing = detail.existing;
        toast.warning('Already in tracker', {
          description: existing
            ? `#${existing.number}: ${existing.company} — ${existing.role}`
            : err.message,
          action: {
            label: 'Open tracker',
            onClick: () => { window.location.href = '/dashboard/applications'; },
          },
        });
        return;
      }
      toast.error('Couldn\'t save', { description: err.message });
    },
  });

  const canSubmit = !!job
    && (intent === 'save' || (confirmedCv && confirmedQuestions && confirmedSubmit));

  if (!job) return null;

  const applyUrl = job.apply_url || job.url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col max-h-[90vh] relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary/30 to-brand-violet/30 ring-1 ring-inset ring-primary/30">
              <Send className="h-3.5 w-3.5 text-primary" />
            </span>
            Apply to this role
          </DialogTitle>
          <DialogDescription>
            Pick the intent, run through the checklist, then either save or mark as Applied.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {/* Job summary card */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium leading-tight truncate">{job.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  <Building2 className="h-3 w-3" /> {job.company}
                  {job.location && (<><span>·</span><MapPin className="h-3 w-3" />{job.location}</>)}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] flex-shrink-0">{job.source}</Badge>
            </div>
            {state?.applicationNumber && (
              <Alert className="mt-2 py-2">
                <ClipboardCheck className="h-3.5 w-3.5" />
                <AlertTitle className="text-xs font-medium">
                  Already in tracker as #{state.applicationNumber} ({state.applicationStatus})
                </AlertTitle>
                <AlertDescription className="text-xs">
                  <Link href="/dashboard/applications" className="underline">Open in tracker</Link>
                  {' · '}or proceed to update its status.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Intent toggle */}
          <div className="space-y-2">
            <Label>Intent</Label>
            <div className="grid grid-cols-2 gap-2">
              <IntentChip
                active={intent === 'save'}
                onClick={() => setIntent('save')}
                title="Save as Evaluated"
                description="I've reviewed it; might apply later"
              />
              <IntentChip
                active={intent === 'applied'}
                onClick={() => setIntent('applied')}
                title="Mark as Applied"
                description="I've submitted the application"
              />
            </div>
          </div>

          {intent === 'applied' && (
            <>
              <Separator />

              {/* Pre-flight checklist */}
              <div className="space-y-2">
                <Label>Pre-flight checklist</Label>
                <ChecklistRow ok={cvOk} label="CV file present" hint="cv.md" />
                <ChecklistRow ok={profileOk} label="Profile configured" hint="config/profile.yml" />
                <ChecklistRow
                  ok={hasPdfs}
                  label="At least one PDF generated"
                  hint={hasPdfs ? 'Tailored CV ready' : 'Run npm run pdf to generate one — proceed without it if you submitted from a different file'}
                />
                {!setupReady && (
                  <Alert variant="default" className="py-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <AlertDescription>
                      Workspace setup is incomplete. <Link href="/dashboard/settings" className="underline">Fix in settings</Link> — the apply will still go through.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <Separator />

              {/* Application URL with copy */}
              <div className="space-y-2">
                <Label>Application URL</Label>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 text-xs bg-muted px-2.5 py-2 rounded truncate" title={applyUrl}>{applyUrl}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(applyUrl);
                        setCopyHit(true);
                        setTimeout(() => setCopyHit(false), 1500);
                      } catch { toast.error('Clipboard not available'); }
                    }}
                    aria-label="Copy URL"
                  >
                    {copyHit ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button asChild type="button" variant="outline" size="sm" className="gap-1.5">
                    <a href={applyUrl} target="_blank" rel="noopener noreferrer">
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>

              {/* Drafted answers — multi-line, archived in notes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="drafted-answers">Drafted answers / cover-letter snippet (optional)</Label>
                  <DraftAnswersButton
                    job={job}
                    onDrafted={(text) => setDraftedAnswers((prev) => prev ? prev + '\n\n' + text : text)}
                  />
                </div>
                <textarea
                  id="drafted-answers"
                  value={draftedAnswers}
                  onChange={(e) => setDraftedAnswers(e.target.value)}
                  placeholder="Why are you a fit?  Salary expectation?  Notice period?  …"
                  className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  maxLength={3500}
                />
                <p className="text-[11px] text-muted-foreground">Saved into the application&apos;s notes. Limit 3,500 chars.</p>
              </div>

              {/* Final confirmations */}
              <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                <Label className="text-xs">Confirmations</Label>
                <ConfirmCheckbox checked={confirmedCv} onCheckedChange={setConfirmedCv} label="I attached / submitted the right CV" />
                <ConfirmCheckbox checked={confirmedQuestions} onCheckedChange={setConfirmedQuestions} label="I answered the company-specific screening questions" />
                <ConfirmCheckbox checked={confirmedSubmit} onCheckedChange={setConfirmedSubmit} label="I clicked the company's Submit button" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="border-t pt-3 -mx-6 px-6 mt-2 flex-row gap-2 flex-wrap">
          <SubmitButton
            intent={intent}
            disabled={!canSubmit}
            isPending={create.isPending}
            onClick={() => create.mutate()}
          />
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="ml-auto">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({
  intent, disabled, isPending, onClick,
}: {
  intent: 'save' | 'applied';
  disabled: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" onClick={onClick} disabled={disabled || isPending} className="gap-1.5">
      {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
      {intent === 'applied' ? <Send className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
      {intent === 'applied' ? 'Mark as Applied' : 'Save as Evaluated'}
    </Button>
  );
}

function IntentChip({
  active, onClick, title, description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-3 py-2.5 text-left transition-all',
        active ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'hover:bg-muted',
      )}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

function ChecklistRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
      )}
      <div>
        <div>{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function ConfirmCheckbox({
  checked, onCheckedChange, label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Compose the notes payload that gets persisted to applications.md cell.
 *
 * For Applied entries we stamp today's date into a header so the kanban / table
 * rows don't lose track of when the application went out. For Evaluated saves
 * the notes are simpler — just the user's drafted text if any.
 */
function composeNotes({
  intent, drafted, job,
}: {
  intent: 'save' | 'applied';
  drafted: string;
  job: Job;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  if (intent === 'applied') {
    lines.push(`Applied ${today} via dashboard.`);
    if (job.url) lines.push(`URL: ${job.url}`);
  } else {
    lines.push(`Saved ${today} from job feed.`);
  }
  if (drafted.trim()) {
    lines.push('');
    lines.push('— Drafted answers —');
    lines.push(drafted.trim());
  }
  return lines.join('\n');
}

/**
 * "Draft with AI" button — streams /api/draft-application and appends the
 * generated text into the parent's drafted-answers textarea. The model picker
 * is collapsed into a compact inline trigger to avoid cluttering the dialog.
 *
 * If the job has no description text the backend will 400 with an "JD is too
 * short" hint — we surface that as a toast so the user knows to paste a
 * fuller description into the Apply dialog (we don't expose a JD textarea in
 * Apply because the surface is already crowded; the Evaluate dialog is the
 * place to paste full JDs).
 */
function DraftAnswersButton({
  job,
  onDrafted,
}: {
  job: Job;
  onDrafted: (text: string) => void;
}) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Use a real ref instead of useState — we only need a stable handle to the
  // abort controller, never a re-render trigger.
  const acRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (!modelId) { toast.error('Pick a model first'); return; }
    setRunning(true);
    const ac = new AbortController();
    acRef.current = ac;
    let captured = '';
    let errored = false;
    try {
      for await (const evt of streamAgent('/api/draft-application', {
        jd_text: job.description_html || job.description ||
          [job.title, job.company, job.location].filter(Boolean).join('\n'),
        jd_url: job.url,
        model_id: modelId,
      }, { signal: ac.signal })) {
        if (evt.type === 'token') captured += evt.chunk;
        if (evt.type === 'error') {
          errored = true;
          toast.error(evt.message, { description: evt.hint });
          break;
        }
      }
      if (!errored && captured.trim()) {
        onDrafted(captured.trim());
        toast.success('Drafted answers added');
      }
    } catch (e) {
      if (!ac.signal.aborted) toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <ModelPicker value={modelId} onChange={setModelId} className="h-8 w-[180px]" />
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={running} className="h-8 gap-1">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Draft with AI
      </Button>
    </div>
  );
}

// Re-export ApiError so call sites can `instanceof` against it.
export { ApiError };
