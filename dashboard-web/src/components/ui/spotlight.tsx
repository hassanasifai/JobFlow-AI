'use client';

// Spotlight — a soft radial highlight that follows the cursor across a hero
// container. Adapted from Aceternity UI (MIT). Disabled on touch devices and
// honors prefers-reduced-motion via the global media query.

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function Spotlight({
  className,
  fill = 'hsl(var(--brand-cyan) / 0.18)',
  size = 600,
}: {
  className?: string;
  fill?: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 0 });
  const [hovering, setHovering] = useState(false);

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setPos({
          x: ((e.clientX - rect.left) / rect.width) * 100,
          y: ((e.clientY - rect.top) / rect.height) * 100,
        });
      }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      className={cn('pointer-events-auto absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      <div
        style={{
          background: `radial-gradient(${size}px circle at ${pos.x}% ${pos.y}%, ${fill}, transparent 60%)`,
          opacity: hovering ? 1 : 0.7,
        }}
        className="absolute inset-0 transition-opacity duration-500"
      />
    </div>
  );
}
