'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Bell, AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Follow-up cadence — surfaces `followup-cadence.mjs --summary` JSON output
 * as a sortable table of suggested next actions.
 */
export default function FollowupsPage() {
  const run = useMutation({
    mutationFn: () => api.runCommand('followupCadence'),
  });
  useEffect(() => { run.mutate(); }, []);

  const items = extractFollowups(run.data?.stdout);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Bell}
        title="Follow-ups"
        description="Applications with suggested next-action dates based on time-since-applied + status."
        actions={
          <Button onClick={() => run.mutate()} disabled={run.isPending} variant="outline" className="gap-1.5">
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      {run.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>follow-up cadence failed</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{(run.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {run.isPending ? <Skeleton className="h-40 w-full" /> : (
        <Card>
          <CardHeader><CardTitle className="text-base">Suggested follow-ups</CardTitle></CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nothing due. {run.data?.stdout ? 'Click Refresh to recalculate.' : ''}</p>
            ) : (
              <ul className="divide-y">
                {items.map((it, i) => (
                  <li key={i} className="py-2 flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px]">{it.status || 'pending'}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{it.company || '—'} — {it.role || '—'}</div>
                      <div className="text-xs text-muted-foreground">{it.suggestion || it.detail}</div>
                    </div>
                    {it.urgency && <Badge variant={it.urgency === 'high' ? 'destructive' : 'secondary'}>{it.urgency}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {run.data?.stdout && (
        <Card>
          <CardHeader><CardTitle className="text-base">Raw output</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-3 rounded-md max-h-[40vh] overflow-y-auto">{run.data.stdout}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function extractFollowups(stdout: string | undefined): Array<{
  company?: string; role?: string; status?: string; suggestion?: string; detail?: string; urgency?: string;
}> {
  if (!stdout) return [];
  try {
    const start = stdout.indexOf('{');
    if (start < 0) return [];
    const parsed = JSON.parse(stdout.slice(start));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.followups)) return parsed.followups;
    if (Array.isArray(parsed.items)) return parsed.items;
    return [];
  } catch { return []; }
}
