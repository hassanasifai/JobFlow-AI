'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TrendingUp, AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Patterns analysis — wraps `analyze-patterns.mjs` (already a CLI command
 * exposed via /api/command). On first visit we kick off the run; the user
 * can refresh anytime. Output is the script's JSON; we render the
 * highlights + raw JSON for now and can graph it later (recharts is in the
 * roadmap as L9 / K6).
 */
export default function PatternsPage() {
  const run = useMutation({
    mutationFn: () => api.runCommand('analyzePatterns'),
    onError: (e: Error) => toast.error('Couldn\'t run analysis', { description: e.message }),
  });

  useEffect(() => { run.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const json = parseSummary(run.data?.stdout);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" /> Patterns
          </h1>
          <p className="text-sm text-muted-foreground">
            Status / score / time-to-response patterns from <code className="text-xs px-1 rounded bg-muted">data/applications.md</code>.
          </p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending} variant="outline" className="gap-1.5">
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {run.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>analyze-patterns failed</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{(run.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {run.isPending && <Skeleton className="h-40 w-full" />}

      {!run.isPending && json && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(json).map(([key, value]) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{key}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs leading-relaxed bg-muted/30 p-3 rounded-md overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!run.isPending && !json && run.data && (
        <Card>
          <CardHeader><CardTitle className="text-base">Raw output</CardTitle><CardDescription>analyze-patterns.mjs --summary</CardDescription></CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded-md max-h-[60vh] overflow-y-auto">{run.data.stdout}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function parseSummary(stdout: string | undefined): Record<string, unknown> | null {
  if (!stdout) return null;
  try {
    const trimmed = stdout.trim();
    const start = trimmed.indexOf('{');
    if (start < 0) return null;
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}
