'use client';

// BorderBeam — a single bright dot that travels along a card's perimeter,
// drawing a thin gradient trail behind it. Used to mark AI-driven affordances
// (Evaluate, CV Studio, Apply) so they feel "alive" without being noisy.
// Adapted from Magic UI (MIT).

import { cn } from '@/lib/utils';

export function BorderBeam({
  className,
  size = 200,
  duration = 8,
  delay = 0,
  colorFrom = 'hsl(var(--brand-cyan))',
  colorTo = 'hsl(var(--brand-violet))',
}: {
  className?: string;
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <div
      style={
        {
          '--size': `${size}px`,
          '--duration': `${duration}s`,
          '--delay': `-${delay}s`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as React.CSSProperties
      }
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] [border:1px_solid_transparent]',
        '![mask-clip:padding-box,border-box] ![mask-composite:intersect]',
        '[mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]',
        'after:absolute after:aspect-square after:w-[var(--size)]',
        'after:animate-[beam_var(--duration)_infinite_linear]',
        'after:[animation-delay:var(--delay)]',
        'after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)]',
        'after:[offset-anchor:90%_50%]',
        'after:[offset-path:rect(0_auto_auto_0_round_var(--size))]',
        className,
      )}
    />
  );
}
