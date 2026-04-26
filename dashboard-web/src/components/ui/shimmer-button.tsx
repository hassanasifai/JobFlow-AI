'use client';

// ShimmerButton — primary CTA with a subtle shimmer that runs along its
// surface. Use sparingly: AI-run buttons, "Apply" CTA, "Probe sources now".
// Adapted from Magic UI (MIT). Composable with shadcn Button via asChild
// pattern but kept as a standalone component for clarity.

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type ShimmerButtonProps = React.ComponentProps<'button'>;

export const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  function ShimmerButton({ className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'group relative inline-flex h-9 cursor-pointer items-center justify-center gap-2',
          'overflow-hidden rounded-lg border border-primary/40 bg-primary px-4 py-2',
          'text-sm font-medium text-primary-foreground',
          'transition-all duration-200',
          'hover:shadow-[0_0_24px_-4px_hsl(var(--primary)/0.6)]',
          'active:scale-[0.97]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      >
        {/* shimmer overlay */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-full transition-transform duration-1000"
        />
        {children}
      </button>
    );
  },
);
