'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApplicationRow, api } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUS_OPTIONS } from '@/lib/states';
import { FileText, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { ApplicationNotesEditor } from '@/components/application-notes-editor';

export function ApplicationsTable({ applications }: { applications: ApplicationRow[] }) {
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: ({ number, status }: { number: number; status: string }) =>
      api.setApplicationStatus(number, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['overview'] }),
    onError: (e: Error) => toast.error('Couldn\'t change status', { description: e.message }),
  });

  if (applications.length === 0) {
    return (
      <div className="px-8 py-16 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
        No applications yet. Save a job from the <Link href="/jobs" className="underline">Jobs</Link> page or add a URL to the <Link href="/pipeline" className="underline">Pipeline</Link>.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead className="w-24">Date</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="w-20">Score</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="w-24">Artifacts</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((a) => (
            <TableRow key={a.number}>
              <TableCell className="text-muted-foreground tabular-nums">{a.number}</TableCell>
              <TableCell className="text-xs">{a.date}</TableCell>
              <TableCell className="font-medium truncate max-w-[180px]">{a.company}</TableCell>
              <TableCell className="truncate max-w-[260px]">{a.role}</TableCell>
              <TableCell>{a.score > 0 && <Badge variant="secondary">{a.scoreRaw}</Badge>}</TableCell>
              <TableCell>
                <Select
                  value={STATUS_OPTIONS.includes(a.status as typeof STATUS_OPTIONS[number]) ? a.status : 'Evaluated'}
                  onValueChange={(v) => setStatus.mutate({ number: a.number, status: v })}
                  disabled={setStatus.isPending}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="space-x-1">
                {a.reportPath && (
                  <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Open report">
                    <Link href={`/reports?path=${encodeURIComponent(a.reportPath)}`}>
                      <FileText className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
                {a.pdf && (
                  <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="PDF available">
                    <Link href="/outputs"><FileDown className="h-3.5 w-3.5" /></Link>
                  </Button>
                )}
              </TableCell>
              <TableCell className="max-w-[280px]">
                <div className="flex items-center gap-2">
                  {a.notes && <span className="text-xs italic truncate flex-1">{a.notes}</span>}
                  <ApplicationNotesEditor application={a} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
