'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, CommandResult, CommandSpec } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Play, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Command runner — surfaces every entry of the existing /api/command catalog
 * (verify, doctor, scan, dedup, merge, normalize, sync-check, analyze-patterns,
 * follow-up, update-{check,apply,rollback}). The catalog is read from the
 * overview response so it stays in lockstep with the backend.
 */
export default function RunPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const commands = overview.data?.commands || [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, CommandResult & { startedAt: string }>>({});

  const run = useMutation({
    mutationFn: (id: string) => api.runCommand(id),
    onMutate: (id) => { setActiveId(id); },
    onSuccess: (result, id) => {
      setHistory((prev) => ({ ...prev, [id]: { ...result, startedAt: new Date().toISOString() } }));
      if (result.ok) toast.success(`${labelFor(commands, id)} done`, { description: `${result.durationMs}ms` });
      else toast.warning(`Exit ${result.code}`, { description: result.stderr?.slice(-200) });
    },
    onError: (e: Error, id) => {
      toast.error(`${id} failed`, { description: e.message });
    },
    onSettled: () => setActiveId(null),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Terminal}
        title="Commands"
        description="Run any of the existing CLI scripts (verify, dedup, merge, normalize, …) with one click."
      />

      {overview.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load commands</AlertTitle>
          <AlertDescription>{(overview.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {overview.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {commands.map((c) => (
            <CommandCard
              key={c.id}
              spec={c}
              busy={activeId === c.id}
              result={history[c.id]}
              onRun={() => run.mutate(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommandCard({
  spec, busy, result, onRun,
}: {
  spec: CommandSpec;
  busy: boolean;
  result: (CommandResult & { startedAt: string }) | undefined;
  onRun: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{spec.label}</CardTitle>
          {result && (
            <Badge variant={result.ok ? 'secondary' : 'destructive'} className="text-[10px]">
              {result.ok ? `${result.durationMs}ms` : `exit ${result.code}`}
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">{spec.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2">
        <Button
          onClick={onRun}
          disabled={busy}
          variant={result?.ok ? 'outline' : 'default'}
          className="gap-1.5"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : result?.ok ? <CheckCircle2 className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {busy ? 'Running…' : result ? 'Re-run' : 'Run'}
        </Button>
        {result && (
          <ScrollArea className={cn('rounded-md border bg-muted/30 max-h-48', !result.ok && 'border-destructive/40')}>
            <pre className="text-[11px] leading-relaxed font-mono p-2 whitespace-pre-wrap">
              {(result.stdout || '').trim() || (result.stderr || '').trim() || '(no output)'}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function labelFor(commands: CommandSpec[], id: string): string {
  return commands.find((c) => c.id === id)?.label || id;
}
