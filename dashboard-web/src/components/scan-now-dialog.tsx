'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Adapter, ScanJobView } from '@/lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, CheckCircle2, XCircle, Pause, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type ScanPrefill = {
  sources?: string[];
  regions?: string[];
  titles?: string[];
  locations?: string[];
  remote?: boolean;
};

export function ScanNowDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: ScanPrefill;
}) {
  const adapters = useQuery({
    queryKey: ['scanners'],
    queryFn: api.scanners,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Form state — kept locally and reset every time the dialog opens.
  const [sources, setSources] = useState<string[]>(prefill?.sources || []);
  const [titles, setTitles] = useState(prefill?.titles?.join(', ') || '');
  const [regions, setRegions] = useState(prefill?.regions?.join(', ') || '');
  const [locations, setLocations] = useState(prefill?.locations?.join(', ') || '');
  const [remote, setRemote] = useState<boolean | null>(prefill?.remote ?? null);
  const [dryRun, setDryRun] = useState(false);
  const [includeDisabled, setIncludeDisabled] = useState(true);
  // Time-window filter: "any" (no cutoff) or N days (e.g. 7, 30). Defaults
  // to "Last 7 days" so first-time users don't ingest stale 6-month-old
  // archives by accident.
  const [sinceDays, setSinceDays] = useState<string>('7');

  // When prefill changes (e.g. user clicked Run on a saved search), repopulate.
  useEffect(() => {
    if (!open) return;
    setSources(prefill?.sources || []);
    setTitles(prefill?.titles?.join(', ') || '');
    setRegions(prefill?.regions?.join(', ') || '');
    setLocations(prefill?.locations?.join(', ') || '');
    setRemote(prefill?.remote ?? null);
  }, [open, prefill]);

  const eligibleAdapters = useMemo(() => {
    // Hide adapters whose metadata flags them unavailable (Cloudflare-walled,
    // dead feeds, etc.) — they would just fail with a warning anyway. Also
    // hide ToS-grey scrapers.
    return (adapters.data || []).filter((a) => !a.unavailable && a.kind !== 'scrape');
  }, [adapters.data]);

  // Job tracking — once we kick off a scan, jobId carries us through polling.
  const [jobId, setJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<'config' | 'progress'>('config');
  const qc = useQueryClient();

  const startScan = useMutation({
    mutationFn: api.startScan,
    onSuccess: (job) => {
      setJobId(job.job_id);
      setTab('progress');
      toast.info('Scan started', { description: `Job ${job.job_id.slice(0, 8)}…` });
    },
    onError: (e: Error) => toast.error('Failed to start scan', { description: e.message }),
  });

  // Poll every 1.5 s while the job is running.
  const status = useQuery({
    queryKey: ['scan-status', jobId],
    queryFn: () => api.scanStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const data = q.state.data as ScanJobView | undefined;
      if (!data) return 1500;
      return data.state === 'running' || data.state === 'queued' ? 1500 : false;
    },
  });

  // When a scan finishes, refresh the rest of the app's caches so newly
  // accepted jobs show up in the Jobs tab without a hard reload.
  useEffect(() => {
    const s = status.data;
    if (!s) return;
    if (s.state === 'done') {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['sources-health'] });
      toast.success('Scan finished', {
        description: `${s.counts.new} new · ${s.counts.found} fetched · ${s.counts.dedup} dedup`,
      });
    } else if (s.state === 'error') {
      toast.error('Scan failed', { description: s.errors?.[0]?.error });
    }
  }, [status.data?.state]);

  const submit = () => {
    if (sources.length === 0) {
      toast.error('Pick at least one source');
      return;
    }
    const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const sinceN = sinceDays === 'any' ? undefined : Number(sinceDays);
    startScan.mutate({
      sources,
      query: {
        titles: split(titles),
        regions: split(regions),
        locations: split(locations),
        ...(remote == null ? {} : { remote }),
        ...(sinceN ? { since_days: sinceN } : {}),
      },
      dry_run: dryRun,
      include_disabled: includeDisabled,
      persist: !dryRun,
    });
  };

  const reset = () => {
    setJobId(null);
    setTab('config');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="h-5 w-5 text-primary" />Scan now</DialogTitle>
          <DialogDescription>Pick providers + a free-text query, then run. Results stream in below.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="config">Configure</TabsTrigger>
            <TabsTrigger value="progress" disabled={!jobId}>Progress</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="flex-1 overflow-auto space-y-5 pr-1">
            {adapters.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <SourcePicker adapters={eligibleAdapters} selected={sources} onChange={setSources} />
            )}

            <div className="space-y-3">
              <Field label="Title keywords"><Input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="senior backend, AI engineer" /></Field>
              <Field label="Regions"><Input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="pakistan, gcc, remote_worldwide" /></Field>
              <Field label="Locations"><Input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Karachi, Dubai, Riyadh" /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="since-days" className="text-xs">Posted within</Label>
                  <Select value={sinceDays} onValueChange={setSinceDays}>
                    <SelectTrigger id="since-days" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any time</SelectItem>
                      <SelectItem value="1">Last 24 h</SelectItem>
                      <SelectItem value="3">Last 3 days</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end gap-1.5 pb-1.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={remote === true}
                      onCheckedChange={(v) => setRemote(v ? true : null)}
                      id="remote-only"
                    />
                    <Label htmlFor="remote-only">Remote only</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={dryRun} onCheckedChange={setDryRun} id="dry-run" />
                    <Label htmlFor="dry-run">Dry run (don&apos;t persist)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={includeDisabled} onCheckedChange={setIncludeDisabled} id="include-disabled" />
                    <Label htmlFor="include-disabled">Include disabled</Label>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="progress" className="flex-1 overflow-auto pr-1">
            {status.data ? <ProgressView job={status.data} /> : <p className="text-sm text-muted-foreground">Waiting for first event…</p>}
          </TabsContent>
        </Tabs>

        <DialogFooter className="pt-2">
          {tab === 'progress' && status.data?.state === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <Button onClick={submit} disabled={startScan.isPending || sources.length === 0} className="gap-2">
              {startScan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {dryRun ? 'Dry run' : 'Run scan'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SourcePicker({
  adapters, selected, onChange,
}: {
  adapters: Adapter[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };
  const allFree = () => onChange(adapters.filter((a) => !a.requiresKey).map((a) => a.id));
  const clear = () => onChange([]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Sources ({selected.length} selected)</Label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={allFree}>All free</Button>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>Clear</Button>
        </div>
      </div>
      <ScrollArea className="h-48 rounded-md border p-2">
        <div className="grid grid-cols-2 gap-1">
          {adapters.map((a) => {
            const disabled = a.requiresKey && !a.requiresKeySatisfied;
            return (
              <label
                key={a.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
              >
                <Checkbox
                  checked={selected.includes(a.id)}
                  onCheckedChange={() => !disabled && toggle(a.id)}
                  disabled={disabled}
                />
                <span className="flex-1 text-sm font-mono truncate">{a.id}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{a.kind}</Badge>
                {a.requiresKey && (
                  <Badge variant={a.requiresKeySatisfied ? 'secondary' : 'destructive'} className="text-[10px] px-1.5 py-0">
                    key
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function ProgressView({ job }: { job: ScanJobView }) {
  const entries = Object.entries(job.progress);
  const done = entries.filter(([, e]) => e.state === 'ok' || e.state === 'failed').length;
  const total = entries.length || 1;
  const pct = (done / total) * 100;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{labelForState(job.state)}</span>
          <span className="text-muted-foreground">{done}/{total} sources</span>
        </div>
        <Progress value={pct} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Fetched" value={job.counts.found} />
        <Stat label="New" value={job.counts.new} />
        <Stat label="Dedup" value={job.counts.dedup} />
      </div>

      <div className="space-y-1.5">
        {entries.map(([id, e]) => (
          <div key={id} className="flex items-center justify-between rounded-md px-3 py-1.5 bg-muted/40 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <StateIcon state={e.state} />
              <code className="truncate">{id}</code>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums flex items-center gap-3">
              {typeof e.fetched === 'number' && <span>{e.fetched} fetched</span>}
              {typeof e.kept === 'number' && <span>{e.kept} kept</span>}
              {typeof e.ms === 'number' && <span>{e.ms} ms</span>}
              {e.error && <span className="text-destructive">{e.error}</span>}
            </div>
          </div>
        ))}
      </div>

      {job.skipped && job.skipped.length > 0 && (
        <SkippedList skipped={job.skipped} />
      )}
    </div>
  );
}

function SkippedList({ skipped }: { skipped: NonNullable<ScanJobView['skipped']> }) {
  // Group by reason so the list reads cleanly when 6 ATS adapters skip with
  // "no companies configured" alongside 1 unavailable provider.
  const groups = skipped.reduce((acc, s) => {
    (acc[s.reason] = acc[s.reason] || []).push(s);
    return acc;
  }, {} as Record<string, typeof skipped>);

  const labels: Record<string, string> = {
    'disabled': 'Disabled in portals.yml',
    'unavailable': 'Unavailable',
    'missing-env': 'Missing API key',
    'no-inputs': 'Needs companies / URLs',
    'region-mismatch': 'Region filter excluded',
  };

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <div className="text-xs font-medium flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> Skipped ({skipped.length})</div>
      {Object.entries(groups).map(([reason, items]) => (
        <div key={reason} className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{labels[reason] || reason}</div>
          <div className="flex flex-wrap gap-1.5">
            {items.map((s) => (
              <Badge key={s.id} variant="outline" className="text-[10px] gap-1">
                <code>{s.id}</code>
                {s.missing?.length ? ` — ${s.missing.join(', ')}` : null}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StateIcon({ state }: { state: string }) {
  if (state === 'pending') return <Pause className="h-3.5 w-3.5 text-muted-foreground" />;
  if (state === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (state === 'ok') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (state === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function labelForState(s: string) {
  if (s === 'queued') return 'Queued…';
  if (s === 'running') return 'Running…';
  if (s === 'done') return 'Finished';
  if (s === 'error') return 'Failed';
  return s;
}
