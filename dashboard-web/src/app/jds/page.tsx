'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderOpen, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';

/**
 * JDs library — browser for files in jds/. Lists every .txt/.md/.html file
 * with its size + modified time; right pane shows the selected file's full
 * content. Useful for re-running an evaluation against a JD you saved
 * earlier without pasting it again.
 */
export default function JdsPage() {
  const list = useQuery({ queryKey: ['jds'], queryFn: api.listJds });
  const [selected, setSelected] = useState<string | null>(null);
  const content = useQuery({
    queryKey: ['jd', selected],
    queryFn: () => api.readJd(selected!),
    enabled: !!selected,
  });

  // Auto-select the first file the first time we see the list.
  useEffect(() => {
    if (!selected && list.data?.items[0]) setSelected(list.data.items[0].path);
  }, [list.data?.items, selected]);

  return (
    <div className="space-y-5 h-full">
      <PageHeader
        icon={FolderOpen}
        title="JD library"
        description={
          <>Files under <code className="text-xs px-1 rounded bg-muted">jds/</code>. Drop a JD here from the CLI to re-evaluate later.</>
        }
      />

      {list.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t list jds/</AlertTitle>
          <AlertDescription>{(list.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 min-h-[60vh]">
        <Card className="p-2 flex flex-col">
          <CardHeader className="px-2 pt-2 pb-2">
            <CardTitle className="text-sm">Files</CardTitle>
            <CardDescription className="text-xs">{list.data?.items.length ?? 0} entries</CardDescription>
          </CardHeader>
          <ScrollArea className="flex-1 max-h-[60vh]">
            {list.isLoading && <Skeleton className="h-32 w-full" />}
            {!list.isLoading && list.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground italic px-2 py-2">jds/ is empty.</p>
            )}
            <div className="space-y-0.5">
              {list.data?.items.map((it) => (
                <button
                  key={it.path}
                  onClick={() => setSelected(it.path)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2',
                    selected === it.path ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-[11px] text-muted-foreground">{relativeTime(it.modifiedAt)} · {(it.size / 1024).toFixed(1)} KB</div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </Card>

        <Card className="p-0 flex flex-col overflow-hidden">
          <CardHeader className="px-4 pt-3 pb-2">
            <CardTitle className="text-sm font-mono truncate">{selected || '(none)'}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {content.isLoading && <Skeleton className="h-32 w-full m-4" />}
            {content.error && (
              <Alert variant="destructive" className="m-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Couldn&apos;t load file</AlertTitle>
                <AlertDescription>{(content.error as Error).message}</AlertDescription>
              </Alert>
            )}
            {content.data && (
              <ScrollArea className="max-h-[60vh]">
                <pre className="px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">{content.data.content}</pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
