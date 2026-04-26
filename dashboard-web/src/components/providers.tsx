'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommandPaletteProvider } from '@/components/ui/command-palette';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per app instance. State (cache, mutations) lives here.
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,            // a half-minute is plenty for a job list
          refetchOnWindowFocus: false,  // dashboard doesn't need aggressive refetch
          retry: 1,
        },
      },
    }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200}>
          <CommandPaletteProvider>
            {children}
            <Toaster richColors position="top-right" />
          </CommandPaletteProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
