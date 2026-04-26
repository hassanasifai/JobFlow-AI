'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileDown, Search, AlertTriangle, ExternalLink } from 'lucide-react';
import { relativeTime } from '@/lib/format';

export default function OutputsPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const all = overview.data?.outputs || [];
    const ql = q.toLowerCase().trim();
    return ql ? all.filter((o) => o.name.toLowerCase().includes(ql)) : all;
  }, [overview.data?.outputs, q]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileDown className="h-6 w-6 text-primary" /> Outputs
        </h1>
        <p className="text-sm text-muted-foreground">
          Generated PDFs and tailored CVs under <code className="text-xs px-1 rounded bg-muted">output/</code>.
        </p>
      </div>

      {overview.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load outputs</AlertTitle>
          <AlertDescription>{(overview.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" className="pl-9" />
      </div>

      {overview.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-8 py-16 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
          No outputs yet. Run <code className="px-1 rounded bg-muted">npm run pdf</code> or <code className="px-1 rounded bg-muted">/career-ops pdf</code> to generate one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((o) => (
            <Card key={o.path} className="p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
              <div className="h-10 w-10 rounded-md bg-primary/10 grid place-items-center text-primary flex-shrink-0">
                <FileDown className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate" title={o.name}>{o.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(o.size / 1024).toFixed(1)} KB · {relativeTime(o.modifiedAt)}
                </div>
                <Button asChild variant="ghost" size="sm" className="-ml-2 mt-1 h-7 px-2 text-xs gap-1">
                  <a href={o.url} target="_blank" rel="noopener noreferrer">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
