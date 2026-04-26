'use client';

// DialogShell — shared chrome for every agent-driven dialog (Apply, Evaluate,
// CV Studio, Quick Eval, Scan Now). Provides:
//   • subtle gradient header strip
//   • optional BorderBeam when an AI run is "live"
//   • consistent radii, padding, max-width
//
// Pages keep using shadcn <Dialog> for state — this just wraps the content.

import { cn } from '@/lib/utils';
import { BorderBeam } from '@/components/ui/border-beam';

export function DialogShell({
  children,
  running = false,
  className,
}: {
  children: React.ReactNode;
  running?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-[inherit]', className)}>
      {/* Top gradient strip */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
      {/* AI-running indicator */}
      {running && <BorderBeam size={140} duration={5} />}
      {children}
    </div>
  );
}
