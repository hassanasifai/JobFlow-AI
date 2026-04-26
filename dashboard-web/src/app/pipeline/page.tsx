'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PipelineItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FilePlus2, Loader2, Trash2, Activity, ExternalLink, Eye, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';

export default function PipelinePage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: (body: { url: string; company?: string; role?: string }) => api.pipelineAdd(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Added to pipeline');
    },
    onError: (e: Error) => toast.error('Couldn\'t add', { description: e.message }),
  });

  const toggle = useMutation({
    mutationFn: ({ lineNumber, checked }: { lineNumber: number; checked: boolean }) =>
      api.pipelineToggle(lineNumber, checked),
    // Optimistic — mark the row done immediately so the user sees it move.
    onMutate: async ({ lineNumber, checked }) => {
      await qc.cancelQueries({ queryKey: ['overview'] });
      const prev = qc.getQueryData<{ pipelineItems: { pending: PipelineItem[]; processed: PipelineItem[] } }>(['overview']);
      if (prev) {
        const all = [...prev.pipelineItems.pending, ...prev.pipelineItems.processed];
        const next = all.map((p) => p.lineNumber === lineNumber ? { ...p, checked } : p);
        qc.setQueryData(['overview'], {
          ...prev,
          pipelineItems: {
            pending: next.filter((p) => !p.checked),
            processed: next.filter((p) => p.checked),
            total: next.length,
          },
        });
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['overview'], ctx.prev);
      toast.error('Couldn\'t update', { description: e.message });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['overview'] }),
  });

  const remove = useMutation({
    mutationFn: (lineNumber: number) => api.pipelineRemove(lineNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Removed');
    },
    onError: (e: Error) => toast.error('Couldn\'t remove', { description: e.message }),
  });

  const liveness = useMutation({
    mutationFn: (urls: string[]) => api.liveness(urls),
    onSuccess: (res) => {
      const out = (res.stdout || res.stderr || '').slice(0, 240);
      if (res.ok) toast.success('Liveness check ran', { description: out || 'See output for details.' });
      else toast.warning('Liveness exit code ' + res.code, { description: out });
    },
    onError: (e: Error) => toast.error('Liveness failed', { description: e.message }),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FilePlus2}
        title="Pipeline"
        description="The inbox of pending JD URLs you've discovered. Mark as processed once you've evaluated them."
      />

      {overview.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load pipeline</AlertTitle>
          <AlertDescription>{(overview.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <AddUrlForm onSubmit={(body) => add.mutate(body)} submitting={add.isPending} />

      {overview.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Section
            title="Pending"
            description="Not yet evaluated"
            items={overview.data?.pipelineItems.pending || []}
            onToggle={(lineNumber, checked) => toggle.mutate({ lineNumber, checked })}
            onRemove={(lineNumber) => remove.mutate(lineNumber)}
            onLiveness={(url) => liveness.mutate([url])}
          />
          <Section
            title="Processed"
            description="Evaluated and moved on"
            items={overview.data?.pipelineItems.processed || []}
            onToggle={(lineNumber, checked) => toggle.mutate({ lineNumber, checked })}
            onRemove={(lineNumber) => remove.mutate(lineNumber)}
            onLiveness={(url) => liveness.mutate([url])}
          />
        </>
      )}
    </div>
  );
}

function AddUrlForm({
  onSubmit, submitting,
}: {
  onSubmit: (body: { url: string; company?: string; role?: string }) => void;
  submitting: boolean;
}) {
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^https?:\/\//.test(url.trim())) {
      toast.error('URL must start with http:// or https://');
      return;
    }
    onSubmit({ url: url.trim(), company: company.trim() || undefined, role: role.trim() || undefined });
    setUrl(''); setCompany(''); setRole('');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add a JD URL</CardTitle>
        <CardDescription>Quickly drop a job posting URL into your pipeline. Company and role are optional.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2">
          <div className="space-y-1">
            <Label htmlFor="pipeline-add-url" className="sr-only">URL</Label>
            <Input
              id="pipeline-add-url"
              type="url"
              required
              placeholder="https://jobs.example.com/role/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pipeline-add-company" className="sr-only">Company</Label>
            <Input
              id="pipeline-add-company"
              placeholder="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pipeline-add-role" className="sr-only">Role</Label>
            <Input
              id="pipeline-add-role"
              placeholder="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Section({
  title, description, items, onToggle, onRemove, onLiveness,
}: {
  title: string;
  description: string;
  items: PipelineItem[];
  onToggle: (lineNumber: number, checked: boolean) => void;
  onRemove: (lineNumber: number) => void;
  onLiveness: (url: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </CardHeader>
      <CardContent className="p-2 space-y-1">
        {items.length === 0 && <p className="text-sm text-muted-foreground italic px-3 py-4">Nothing here yet.</p>}
        {items.map((p) => (
          <PipelineRow
            key={p.lineNumber}
            item={p}
            onToggle={(checked) => onToggle(p.lineNumber, checked)}
            onRemove={() => onRemove(p.lineNumber)}
            onLiveness={() => onLiveness(p.url)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PipelineRow({
  item, onToggle, onRemove, onLiveness,
}: {
  item: PipelineItem;
  onToggle: (checked: boolean) => void;
  onRemove: () => void;
  onLiveness: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-muted/50 group">
      <Checkbox checked={item.checked} onCheckedChange={(v) => onToggle(!!v)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate">{item.role}</span>
          {item.company !== 'Unknown company' && <span className="text-muted-foreground">·</span>}
          {item.company !== 'Unknown company' && <span className="text-muted-foreground truncate">{item.company}</span>}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:underline truncate block break-all"
        >
          {item.url}
        </a>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Open posting"
        >
          <a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Liveness check" onClick={onLiveness}>
          <Activity className="h-3.5 w-3.5" />
        </Button>
        <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Open in jobs detail drawer">
          <a href={`/dashboard/jobs?job=${encodeURIComponent(item.url)}`}>
            <Eye className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
