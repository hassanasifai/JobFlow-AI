'use client';

// AnimatedGridPattern — subtle dot/grid background where a few cells
// occasionally light up and fade. Used as a hero backdrop on / Overview.
// Adapted from Magic UI (MIT).

import { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function AnimatedGridPattern({
  width = 36,
  height = 36,
  numSquares = 32,
  maxOpacity = 0.18,
  duration = 3,
  className,
}: {
  width?: number;
  height?: number;
  numSquares?: number;
  maxOpacity?: number;
  duration?: number;
  className?: string;
}) {
  const id = useId();
  const containerRef = useRef<SVGSVGElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [squares, setSquares] = useState(() => generateSquares(numSquares, dimensions, width, height));

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (dimensions.width && dimensions.height) {
      setSquares(generateSquares(numSquares, dimensions, width, height));
    }
  }, [dimensions, numSquares, width, height]);

  return (
    <svg
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full fill-foreground/10 stroke-foreground/10',
        className,
      )}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={-1} y={-1}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      <svg x={0} y={0} className="overflow-visible">
        {squares.map(({ pos: [x, y], id: sid }, i) => (
          <motion.rect
            key={`${sid}-${i}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, maxOpacity, 0] }}
            transition={{
              duration,
              repeat: Infinity,
              delay: i * 0.1,
              ease: 'easeInOut',
              repeatType: 'reverse',
            }}
            width={width - 1}
            height={height - 1}
            x={x * width + 1}
            y={y * height + 1}
            fill="currentColor"
            strokeWidth={0}
          />
        ))}
      </svg>
    </svg>
  );
}

function generateSquares(
  count: number,
  dim: { width: number; height: number },
  w: number,
  h: number,
) {
  if (!dim.width || !dim.height) return [];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    pos: [
      Math.floor((Math.random() * dim.width) / w),
      Math.floor((Math.random() * dim.height) / h),
    ] as [number, number],
  }));
}
