'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, SavedSearch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Bookmark, Plus, Pencil, Trash2, Play, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { relativeTime } from '@/lib/format';
import { ScanNowDialog } from '@/components/scan-now-dialog';

const formSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use a slug: lowercase letters, digits, _ or -, ≤ 64 chars').or(z.literal('')),
  name: z.string().min(1, 'Name is required').max(200),
  region: z.string().optional(),
  titles: z.string().optional(),
  sources: z.string().optional(),
  locations: z.string().optional(),
  since_days: z.string().optional(),
  // The default lives in `defaultValues` below — Zod's `.default()` adds an
  // input/output asymmetry that conflicts with @hookform/resolvers v5.
  remote: z.enum(['any', 'true', 'false']),
});
type FormShape = z.infer<typeof formSchema>;

function toListSpec(text?: string): string[] {
  return (text || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function toFormCsv(arr: string[] | undefined): string {
  return (arr || []).join(', ');
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export default function SavedSearchesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['saved-searches'], queryFn: api.listSavedSearches });
  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPrefill, setScanPrefill] = useState<SavedSearch | null>(null);

  const upsert = useMutation({
    mutationFn: api.upsertSavedSearch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-searches'] });
      toast.success('Saved');
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: api.deleteSavedSearch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-searches'] });
      toast.success('Deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleRun = (s: SavedSearch) => {
    setScanPrefill(s);
    setScanOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bookmark}
        title="Saved searches"
        description="Reusable filters. Each saves the regions, titles, and providers you care about."
        actions={
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)} className="gap-2">
                <Plus className="h-4 w-4" /> New
              </Button>
            </DialogTrigger>
            <SavedSearchForm
              initial={editing}
              onSubmit={(values) => upsert.mutate(values)}
              submitting={upsert.isPending}
            />
          </Dialog>
        }
      />

      {list.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load saved searches</AlertTitle>
          <AlertDescription>{(list.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {list.isLoading ? (
        <SavedSkeleton />
      ) : (list.data?.items.length || 0) === 0 ? (
        <Card className="px-8 py-16 text-center space-y-2 border-dashed">
          <Bookmark className="h-10 w-10 mx-auto text-muted-foreground" />
          <div className="text-base font-medium">No saved searches yet</div>
          <div className="text-sm text-muted-foreground max-w-md mx-auto">
            Saved searches let you re-run a scan without re-typing filters. Click <strong>New</strong> above.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.data?.items.map((s) => (
            <Card key={s.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{s.name}</CardTitle>
                <code className="text-xs text-muted-foreground font-mono">{s.id}</code>
              </CardHeader>
              <CardContent className="flex-1 space-y-2">
                {s.region.length > 0 && <ChipRow label="Region" items={s.region} />}
                {s.titles.length > 0 && <ChipRow label="Titles" items={s.titles} />}
                {s.sources.length > 0 && <ChipRow label="Sources" items={s.sources} />}
                {s.locations.length > 0 && <ChipRow label="Locations" items={s.locations} />}
                <div className="text-xs text-muted-foreground pt-1">
                  {s.since_days ? `Last ${s.since_days} days · ` : ''}
                  {s.remote === true ? 'Remote only · ' : s.remote === false ? 'On-site only · ' : ''}
                  Updated {relativeTime(s.updated_at)}
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={() => handleRun(s)} className="gap-1 flex-1">
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { setEditing(s); setDialogOpen(true); }}
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (confirm(`Delete "${s.name}"?`)) remove.mutate(s.id);
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <ScanNowDialog
        open={scanOpen}
        onOpenChange={(o) => { setScanOpen(o); if (!o) setScanPrefill(null); }}
        prefill={scanPrefill ? {
          sources: scanPrefill.sources,
          regions: scanPrefill.region,
          titles: scanPrefill.titles,
          locations: scanPrefill.locations,
          remote: scanPrefill.remote ?? undefined,
        } : undefined}
      />
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 8).map((v) => (
          <Badge key={v} variant="secondary" className="text-[10px] px-1.5 py-0">{v}</Badge>
        ))}
        {items.length > 8 && <span className="text-xs text-muted-foreground">+{items.length - 8}</span>}
      </div>
    </div>
  );
}

function SavedSearchForm({
  initial,
  onSubmit,
  submitting,
}: {
  initial: SavedSearch | null;
  onSubmit: (values: Parameters<typeof api.upsertSavedSearch>[0]) => void;
  submitting: boolean;
}) {
  const form = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: initial?.id || '',
      name: initial?.name || '',
      region: toFormCsv(initial?.region),
      titles: toFormCsv(initial?.titles),
      sources: toFormCsv(initial?.sources),
      locations: toFormCsv(initial?.locations),
      since_days: initial?.since_days ? String(initial.since_days) : '',
      remote: initial?.remote === true ? 'true' : initial?.remote === false ? 'false' : 'any',
    },
  });

  const submit = form.handleSubmit((values) => {
    const id = values.id || slugify(values.name);
    onSubmit({
      id,
      name: values.name,
      region: toListSpec(values.region),
      titles: toListSpec(values.titles),
      sources: toListSpec(values.sources),
      locations: toListSpec(values.locations),
      since_days: values.since_days ? Number(values.since_days) : null,
      remote: values.remote === 'true' ? true : values.remote === 'false' ? false : null,
    });
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit saved search' : 'New saved search'}</DialogTitle>
        <DialogDescription>Comma-separate multi-value fields.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" error={form.formState.errors.name?.message}>
          <Input {...form.register('name')} placeholder="Pakistan engineering" autoFocus />
        </Field>
        <Field label="ID (slug)" error={form.formState.errors.id?.message} hint="Auto-derived from name if empty.">
          <Input {...form.register('id')} placeholder={initial?.id || 'pk-engineering'} disabled={!!initial} />
        </Field>
        <Field label="Regions">
          <Input {...form.register('region')} placeholder="pakistan, gcc" />
        </Field>
        <Field label="Title keywords">
          <Input {...form.register('titles')} placeholder="engineer, developer, full stack" />
        </Field>
        <Field label="Sources">
          <Input {...form.register('sources')} placeholder="greenhouse, mustakbil, remoteok" />
        </Field>
        <Field label="Locations">
          <Input {...form.register('locations')} placeholder="Karachi, Lahore, Dubai" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Since (days)">
            <Input {...form.register('since_days')} type="number" min="1" max="365" placeholder="7" />
          </Field>
          <Field label="Remote">
            <select
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              {...form.register('remote')}
            >
              <option value="any">Any</option>
              <option value="true">Remote only</option>
              <option value="false">On-site only</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : initial ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({
  label, hint, error, children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SavedSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-4 space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </Card>
      ))}
    </div>
  );
}
