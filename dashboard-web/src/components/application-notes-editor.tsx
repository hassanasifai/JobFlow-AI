'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApplicationRow, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ApplicationNotesEditor({
  application,
  compact = false,
}: {
  application: ApplicationRow;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(application.notes || '');
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => api.setApplicationNotes(application.number, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Notes saved');
      setEditing(false);
    },
    onError: (e: Error) => toast.error('Couldn\'t save notes', { description: e.message }),
  });

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-6 px-1.5', compact ? 'text-[10px]' : 'text-xs')}
        onClick={(e) => { e.stopPropagation(); setDraft(application.notes || ''); setEditing(true); }}
      >
        <Pencil className="h-3 w-3 mr-1" />
        {application.notes ? 'Edit notes' : 'Add notes'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        className="h-7 text-xs flex-1"
        maxLength={1000}
        placeholder="Notes…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') save.mutate();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
