'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ClipboardList, Search, AlertTriangle, Columns3, Rows3 } from 'lucide-react';
import { ApplicationsBoard } from '@/components/applications-board';
import { ApplicationsTable } from '@/components/applications-table';
import { STATUS_OPTIONS, STATUS_COLOR } from '@/lib/states';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';

export default function ApplicationsPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 60_000 });
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const all = overview.data?.applications || [];
    const ql = q.toLowerCase().trim();
    return all.filter((a) => {
      if (ql && !`${a.company} ${a.role} ${a.notes}`.toLowerCase().includes(ql)) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      return true;
    });
  }, [overview.data?.applications, q, statusFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardList}
        title="Applications"
        description="Track every role you've evaluated. Drag-and-drop between columns or change status inline."
        actions={
          <Tabs value={view} onValueChange={(v) => setView(v as 'kanban' | 'table')}>
            <TabsList>
              <TabsTrigger value="kanban" className="gap-1.5"><Columns3 className="h-3.5 w-3.5" /> Kanban</TabsTrigger>
              <TabsTrigger value="table" className="gap-1.5"><Rows3 className="h-3.5 w-3.5" /> Table</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {overview.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load applications</AlertTitle>
          <AlertDescription>{(overview.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, role, notes…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={statusFilter === null ? 'default' : 'outline'}
            onClick={() => setStatusFilter(null)}
          >
            All
            <Badge variant="secondary" className="ml-1.5 px-1.5">{(overview.data?.applications || []).length}</Badge>
          </Button>
          {STATUS_OPTIONS.map((s) => {
            const count = (overview.data?.applications || []).filter((a) => a.status === s).length;
            if (count === 0) return null;
            const active = statusFilter === s;
            return (
              <Button
                key={s}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => setStatusFilter(active ? null : s)}
                className="gap-1.5"
              >
                <span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[s])} />
                {s}
                <Badge variant="secondary" className="ml-0.5 px-1.5">{count}</Badge>
              </Button>
            );
          })}
        </div>
      </div>

      {overview.isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : view === 'kanban' ? (
        <ApplicationsBoard applications={filtered} />
      ) : (
        <ApplicationsTable applications={filtered} />
      )}
    </div>
  );
}
