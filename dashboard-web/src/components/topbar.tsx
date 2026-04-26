'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Search, Moon, Sun, Play } from 'lucide-react';
import { useTheme } from 'next-themes';
import { ScanNowDialog } from '@/components/scan-now-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { QuickToolsMenu } from '@/components/quick-tools-menu';

export function Topbar() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [scanOpen, setScanOpen] = useState(false);
  const isDark = (theme === 'dark') || (theme === 'system' && resolvedTheme === 'dark');

  return (
    <header className="border-b bg-background sticky top-0 z-30">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          <span className="hidden md:inline">All scans run locally · zero paid APIs</span>
          <span className="md:hidden">Career-Ops</span>
        </div>
        <div className="flex items-center gap-2">
          <QuickToolsMenu />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                aria-label="Toggle theme"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
          </Tooltip>
          <Button onClick={() => setScanOpen(true)} className="gap-2">
            <Play className="h-4 w-4" />
            Scan now
          </Button>
        </div>
      </div>
      <ScanNowDialog open={scanOpen} onOpenChange={setScanOpen} />
    </header>
  );
}
