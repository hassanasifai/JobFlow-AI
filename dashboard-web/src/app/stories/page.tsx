'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Library, AlertTriangle, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownView } from '@/components/markdown-view';

const STORY_BANK_PATH = 'interview-prep/story-bank.md';

/**
 * Story Bank page — read/write `interview-prep/story-bank.md` directly via
 * the editable-config endpoint. Renders a side-by-side editor + preview;
 * /api/config already supports this path under EDITABLE_FILES if exposed,
 * otherwise falls back gracefully.
 */
export default function StoriesPage() {
  const [content, setContent] = useState<string>('');
  const [exists, setExists] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.configRead(STORY_BANK_PATH);
        if (!alive) return;
        setContent(res.content || '');
        setExists(res.exists);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const save = useMutation({
    mutationFn: () => api.configWrite(STORY_BANK_PATH, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Story bank saved');
      setExists(true);
    },
    onError: (e: Error) => toast.error('Couldn\'t save', { description: e.message }),
  });

  if (loading) return <Skeleton className="h-[60vh] w-full" />;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Library className="h-6 w-6 text-primary" /> Story bank
          </h1>
          <p className="text-sm text-muted-foreground">
            Your STAR+R interview stories. The original career-ops accumulates these across evaluations.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load file</AlertTitle>
          <AlertDescription>
            {error}. The path <code>{STORY_BANK_PATH}</code> may not be in the editable-files allowlist yet.
          </AlertDescription>
        </Alert>
      )}

      {!exists && !error && (
        <Alert>
          <Library className="h-4 w-4" />
          <AlertTitle>Empty story bank</AlertTitle>
          <AlertDescription>Add your first STAR+R story below — Situation / Task / Action / Result + Reflection — and click Save.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[60vh]">
        <Card className="p-3 flex flex-col">
          <CardHeader className="px-0 pt-0 pb-2">
            <CardTitle className="text-sm">Source</CardTitle>
            <CardDescription className="text-xs">{STORY_BANK_PATH}</CardDescription>
          </CardHeader>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs flex-1 w-full resize-none rounded-md border border-input bg-transparent p-3 focus:outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
        </Card>
        <Card className="p-0 overflow-hidden flex flex-col">
          <CardHeader className="px-3 pt-3 pb-2">
            <CardTitle className="text-sm">Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto pt-0">
            <MarkdownView markdown={content || '_(empty)_'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
