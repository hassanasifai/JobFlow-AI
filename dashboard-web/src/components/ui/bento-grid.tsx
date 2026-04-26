'use client';

// BentoGrid — opinionated grid layout primitive for dashboard heroes.
// Adapted from Aceternity UI (MIT). Each child can opt-in to span 2 rows
// or 2 cols via the `featured` prop on BentoCard.

import { cn } from '@/lib/utils';

export function BentoGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid w-full auto-rows-[14rem] grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCard({
  children,
  className,
  span = 'normal',
}: {
  children: React.ReactNode;
  className?: string;
  span?: 'normal' | 'wide' | 'tall' | 'big';
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm',
        'transition-[transform,box-shadow,border-color] duration-300',
        'hover:border-primary/40 hover:shadow-[0_12px_32px_-12px_hsl(var(--primary)/0.25)]',
        span === 'wide' && 'md:col-span-2',
        span === 'tall' && 'md:row-span-2',
        span === 'big' && 'md:col-span-2 md:row-span-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
