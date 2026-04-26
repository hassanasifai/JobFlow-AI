'use client';

// StreamingText — renders text with a blinking cursor at the end while a
// stream is "live", then drops the cursor when done. Pairs with our SSE
// dialogs (Evaluate, CV Studio) to signal active AI generation.

import { cn } from '@/lib/utils';

export function StreamingText({
  text,
  streaming,
  className,
}: {
  text: string;
  streaming: boolean;
  className?: string;
}) {
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {text}
      {streaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[2px] -translate-y-[2px] align-middle bg-primary animate-pulse"
        />
      )}
    </span>
  );
}
