'use client';

// MagicCard — a card whose border lights up where the cursor enters,
// creating a soft moving glow. Use for evaluated job cards, source-health
// tiles, and any "hover-able" data card. Adapted from Aceternity UI (MIT).

import { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'motion/react';
import { cn } from '@/lib/utils';

export function MagicCard({
  children,
  className,
  glowColor = 'hsl(var(--brand-cyan) / 0.4)',
  size = 200,
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-9999);
  const mouseY = useMotionValue(-9999);
  const background = useMotionTemplate`radial-gradient(${size}px circle at ${mouseX}px ${mouseY}px, ${glowColor}, transparent 70%)`;

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        mouseX.set(e.clientX - rect.left);
        mouseY.set(e.clientY - rect.top);
      }}
      onPointerLeave={() => {
        mouseX.set(-9999);
        mouseY.set(-9999);
      }}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/60 bg-card/80',
        'transition-colors duration-300 hover:border-primary/40',
        className,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
