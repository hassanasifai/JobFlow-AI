'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Search, Moon, Sun, Sparkles, Play } from 'lucide-react';
import { useTheme } from 'next-themes';
import { ScanNowDialog } from '@/components/scan-now-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { QuickToolsMenu } from '@/components/quick-tools-menu';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { useCommandPalette } from '@/components/ui/command-palette';
import { cn } from '@/lib/utils';

export function Topbar() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [scanOpen, setScanOpen] = useState(false);
  const isDark = (theme === 'dark') || (theme === 'system' && resolvedTheme === 'dark');
  const palette = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      {/* Subtle gradient bottom border. Inherits the AI cyan/violet vocabulary. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        {/* Cmd+K trigger fills the role of the old "search" line. Click or hit Cmd+K. */}
        <button
          onClick={palette.toggle}
          className={cn(
            'group flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40',
            'px-2.5 py-1.5 text-sm text-muted-foreground transition-all',
            'hover:bg-muted/70 hover:text-foreground hover:border-primary/40',
            'min-w-0 max-w-[28rem] flex-1 sm:flex-initial sm:w-72',
          )}
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/70 group-hover:text-primary transition-colors" />
          <span className="truncate">Jump to anywhere…</span>
          <span className="ml-auto hidden md:inline-flex items-center gap-0.5 text-[10px] tabular-nums">
            <kbd className="rounded border border-border/70 bg-background/60 px-1 py-0.5 font-mono">⌘</kbd>
            <kbd className="rounded border border-border/70 bg-background/60 px-1 py-0.5 font-mono">K</kbd>
          </span>
        </button>

        <div className="flex items-center gap-2">
          <QuickToolsMenu />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                aria-label="Toggle theme"
                className="relative overflow-hidden"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isDark ? (
                    <motion.span
                      key="sun"
                      initial={{ rotate: -45, scale: 0.7, opacity: 0 }}
                      animate={{ rotate: 0, scale: 1, opacity: 1 }}
                      exit={{ rotate: 45, scale: 0.7, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="inline-flex"
                    >
                      <Sun className="h-4 w-4" />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="moon"
                      initial={{ rotate: 45, scale: 0.7, opacity: 0 }}
                      animate={{ rotate: 0, scale: 1, opacity: 1 }}
                      exit={{ rotate: -45, scale: 0.7, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="inline-flex"
                    >
                      <Moon className="h-4 w-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
          </Tooltip>
          <ShimmerButton onClick={() => setScanOpen(true)} className="gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Scan now
          </ShimmerButton>
        </div>
      </div>
      <ScanNowDialog open={scanOpen} onOpenChange={setScanOpen} />
    </header>
  );
}

// Keep the legacy import working in pages that haven't migrated.
export { Play };
