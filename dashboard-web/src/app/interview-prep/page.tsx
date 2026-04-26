'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, streamAgent, StreamEvent } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, MessageCircle, Sparkles, AlertTriangle, Square } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { MarkdownView } from '@/components/markdown-view';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Per-application interview prep — surfaces modes/interview-prep.md. The
 * user picks an Application row (or types company + role manually); the
 * agent pulls the matching evaluation report (if any), composes
 * interview-prep guidance, and streams it back. We also store the result
 * in interview-prep/{company}-{role}.md if the user chooses to save.
 */
export default function InterviewPrepPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [reportPath, setReportPath] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  // Suggest applications already at Interview status.
  const interviewApps = (overview.data?.applications || []).filter((a) => a.status === 'Interview');

  const start = async () => {
    if (!company.trim() || !role.trim()) { toast.error('Company and role required'); return; }
    if (!modelId) { toast.error('Pick a model'); return; }
    setRunning(true);
    setText('');
    setError(null);
    const ac = new AbortController();
    acRef.current = ac;
    try {
      for await (const evt of streamAgent('/api/interview-prep', {
        company,
        role,
        report_path: reportPath || undefined,
        model_id: modelId,
      }, { signal: ac.signal })) {
        if (evt.type === 'token') setText((p) => p + evt.chunk);
        else if (evt.type === 'error') {
          setError(`${evt.message}${evt.hint ? ` — ${evt.hint}` : ''}`);
          toast.error(evt.message, { description: evt.hint });
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(String((e as Error)?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const stop = () => acRef.current?.abort();

  const save = async () => {
    if (!text.trim()) return;
    const slug = `${slugify(company)}-${slugify(role)}`;
    const path = `interview-prep/${slug}.md`;
    try {
      await api.configWrite(path, text);
      toast.success('Saved', { description: path });
    } catch (e) {
      toast.error('Couldn\'t save', { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessageCircle}
        title="Interview prep"
        description="Per-company / per-role intelligence. modes/interview-prep.md generates STAR+R stories tailored to the role, common questions, and behavioral prep."
      />

      {interviewApps.length > 0 && !company && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pick from your active interviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {interviewApps.slice(0, 8).map((a) => (
              <button
                key={a.number}
                onClick={() => { setCompany(a.company); setRole(a.role); setReportPath(a.reportPath || ''); }}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm flex items-center gap-3"
              >
                <span className="text-xs text-muted-foreground tabular-nums w-6">#{a.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{a.role}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.company} · score {a.scoreRaw}</div>
                </div>
                {a.reportPath && <Badge>has report</Badge>}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Generate</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Company</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Anthropic" />
            </div>
            <div className="space-y-1"><Label className="text-xs">Role</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Forward Deployed Engineer" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
            <div className="space-y-1"><Label className="text-xs">Report path (optional)</Label>
              <Input value={reportPath} onChange={(e) => setReportPath(e.target.value)} placeholder="reports/042-anthropic-2026-04-26.md" />
            </div>
            <div className="space-y-1"><Label className="text-xs">Model</Label>
              <ModelPicker value={modelId} onChange={setModelId} className="w-full" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {running ? (
              <Button onClick={stop} variant="destructive" className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button>
            ) : (
              <Button onClick={start} disabled={!modelId || !company || !role} className="gap-1.5">
                <Sparkles className="h-4 w-4" /> {text ? 'Re-run' : 'Generate'}
              </Button>
            )}
            {text && !running && (
              <Button onClick={save} variant="outline" className="gap-1.5">
                Save to interview-prep/
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t complete</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      {(running || text) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Output</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[60vh]">
              <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                {running && !text && <Loader2 className="h-4 w-4 animate-spin" />}
                <MarkdownView markdown={text || '_(awaiting tokens…)_'} />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full ml-auto">{children}</span>;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unknown';
}
