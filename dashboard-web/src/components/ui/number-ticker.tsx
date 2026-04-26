'use client';

// NumberTicker — animated count-up for metric tiles.
// Adapted from Magic UI (MIT). Uses motion's `useMotionValue` + `useSpring`
// so the easing matches the rest of our animation vocabulary.

import { useEffect, useRef } from 'react';
import { useInView, useMotionValue, useSpring } from 'motion/react';
import { cn } from '@/lib/utils';

export function NumberTicker({
  value,
  direction = 'up',
  decimalPlaces = 0,
  delayMs = 0,
  className,
  formatter,
}: {
  value: number;
  direction?: 'up' | 'down';
  decimalPlaces?: number;
  delayMs?: number;
  className?: string;
  formatter?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === 'down' ? value : 0);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const inView = useInView(ref, { once: true, margin: '0px' });

  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => motionValue.set(direction === 'down' ? 0 : value), delayMs);
    return () => clearTimeout(t);
  }, [inView, value, direction, delayMs, motionValue]);

  useEffect(() => {
    return springValue.on('change', (latest) => {
      if (!ref.current) return;
      const out = formatter
        ? formatter(latest)
        : Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(Number(latest.toFixed(decimalPlaces)));
      ref.current.textContent = out;
    });
  }, [springValue, decimalPlaces, formatter]);

  return (
    <span
      ref={ref}
      className={cn('inline-block tabular-nums', className)}
      aria-label={String(value)}
    >
      0
    </span>
  );
}
