'use client';

// ScoreRing — circular SVG arc gauge for evaluation scores.
// Animates fill on mount via motion's path-length spring. Used in:
//   • EvaluateDialog (live as score parses from SSE)
//   • CV Studio (AI confidence)
//   • Job rows (compact 24px variant for list cells)

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function ScoreRing({
  score,
  max = 5,
  size = 56,
  strokeWidth = 5,
  showLabel = true,
  className,
}: {
  score: number | null;
  max?: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / max));

  // Color shifts from rose → amber → cyan → emerald based on score.
  const color =
    pct >= 0.8 ? 'hsl(var(--brand-emerald))' :
    pct >= 0.6 ? 'hsl(var(--brand-cyan))' :
    pct >= 0.4 ? 'hsl(var(--brand-amber))' :
                 'hsl(var(--brand-rose))';

  return (
    <div
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score == null ? 'No score' : `Score ${score} of ${max}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
        />
      </svg>
      {showLabel && (
        <span
          className={cn(
            'absolute font-semibold tabular-nums',
            size <= 28 ? 'text-[9px]' : size <= 40 ? 'text-[11px]' : 'text-sm',
          )}
          style={{ color }}
        >
          {score == null ? '—' : score.toFixed(1)}
        </span>
      )}
    </div>
  );
}
