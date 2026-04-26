'use client';

import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { ApplicationRow, api } from '@/lib/api';
import { STATUS_OPTIONS, STATUS_COLOR, STATUS_TINT, Status } from '@/lib/states';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ApplicationNotesEditor } from '@/components/application-notes-editor';

/**
 * Kanban view for the applications tracker.
 *
 * Drag-and-drop is implemented with native HTML5 dnd — no extra dep. We only
 * use it on desktop; on mobile the user opens an application and changes
 * status via the inline select (same control as the table view).
 */
export function ApplicationsBoard({ applications }: { applications: ApplicationRow[] }) {
  const qc = useQueryClient();
  const [draggingNumber, setDraggingNumber] = useState<number | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ number, status }: { number: number; status: string }) =>
      api.setApplicationStatus(number, status),
    onMutate: async ({ number, status }) => {
      // Optimistic update so the card moves the instant you drop it.
      await qc.cancelQueries({ queryKey: ['overview'] });
      const previous = qc.getQueryData<{ applications: ApplicationRow[] }>(['overview']);
      if (previous) {
        qc.setQueryData(['overview'], {
          ...previous,
          applications: previous.applications.map((a) =>
            a.number === number ? { ...a, status } : a,
          ),
        });
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['overview'], ctx.previous);
      toast.error('Couldn\'t change status', { description: e.message });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['overview'] }),
  });

  const grouped = STATUS_OPTIONS.map((s) => ({
    status: s,
    items: applications.filter((a) => normalize(a.status) === s),
  }));
  // Pin "uncategorized" rows under Evaluated.
  const uncategorized = applications.filter((a) => !STATUS_OPTIONS.includes(normalize(a.status) as Status));
  if (uncategorized.length) grouped[0].items.push(...uncategorized);

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-3 pb-4 min-w-max">
        {grouped.map(({ status, items }) => (
          <Column
            key={status}
            status={status}
            items={items}
            onDropTo={(number) => {
              if (draggingNumber === number) setDraggingNumber(null);
              setStatus.mutate({ number, status });
            }}
            onDragStart={setDraggingNumber}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function Column({
  status,
  items,
  onDropTo,
  onDragStart,
}: {
  status: Status;
  items: ApplicationRow[];
  onDropTo: (number: number) => void;
  onDragStart: (number: number) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('application/x-app-id');
        const num = Number(id);
        if (Number.isFinite(num)) onDropTo(num);
      }}
      className={cn(
        'w-72 flex-shrink-0 rounded-lg border transition-colors',
        STATUS_TINT[status],
        over && 'ring-2 ring-primary',
      )}
    >
      <div className="px-3 py-2.5 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[status])} />
          <span className="text-sm font-medium">{status}</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5">{items.length}</Badge>
      </div>
      <div className="p-2 space-y-2 min-h-[80px]">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-3 text-center italic">No items</p>
        )}
        {items.map((a) => (
          <ApplicationCard key={a.number} app={a} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

function ApplicationCard({
  app,
  onDragStart,
}: {
  app: ApplicationRow;
  onDragStart: (number: number) => void;
}) {
  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-app-id', String(app.number));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(app.number);
      }}
      className="p-3 space-y-1.5 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight truncate">{app.role}</div>
          <div className="text-xs text-muted-foreground truncate">{app.company}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground pl-5">
        <span>#{app.number} · {app.date}</span>
        {app.score > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{app.scoreRaw}</Badge>}
      </div>
      <div className="pl-5 flex flex-wrap gap-1 items-center">
        {app.reportPath && (
          <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]">
            <Link href={`/reports?path=${encodeURIComponent(app.reportPath)}`}>
              <FileText className="h-3 w-3 mr-1" /> Report
            </Link>
          </Button>
        )}
        {app.pdf && <Badge variant="outline" className="text-[10px] px-1.5 py-0">PDF</Badge>}
      </div>
      {app.notes && (
        <div className="pl-5 text-[11px] text-muted-foreground italic line-clamp-2">{app.notes}</div>
      )}
      <div className="pl-5">
        <ApplicationNotesEditor application={app} compact />
      </div>
    </Card>
  );
}

function normalize(status: string): string {
  return (status || '').replace(/\*+/g, '').trim();
}
