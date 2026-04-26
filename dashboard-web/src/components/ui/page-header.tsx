'use client';

// PageHeader — shared title block for every dashboard page.
// Gradient-tinted icon tile + heading + optional description / actions slot.
// Replaces the old inline `<h1>Icon Title</h1>` pattern with one consistent
// look so adding new pages stays trivial.

import { cn } from '@/lib/utils';

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  meta,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/25 via-primary/10 to-brand-violet/25 ring-1 ring-inset ring-primary/30 shadow-sm">
            <Icon className="h-4 w-4 text-primary" />
          </span>
          <span className="min-w-0 truncate">{title}</span>
          {meta && <span className="ml-1 text-sm font-normal text-muted-foreground">{meta}</span>}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-3xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
