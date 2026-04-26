'use client';

// CommandPalette — Cmd+K (or Ctrl+K) global navigator. Wraps `cmdk` in a
// shadcn-styled dialog so we get search + arrow-nav + ENTER selection
// without re-implementing keyboard handling.
//
// Exposes a context hook `useCommandPalette()` so any component can
// open it programmatically (e.g. the Topbar's search button).

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command as CmdK } from 'cmdk';
import {
  Briefcase, ClipboardList, Activity, FileText, Settings, Send,
  Sparkles, FlaskConical, GitCompare, ListChecks, Inbox, Library, Play, BarChart3,
  PanelsTopLeft, Search,
} from 'lucide-react';

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
      <CommandPaletteUi open={open} setOpen={setOpen} />
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const v = useContext(CommandPaletteContext);
  if (!v) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>');
  return v;
}

const ROUTES: Array<{ href: string; label: string; group: string; icon: React.ComponentType<{ className?: string }>; }> = [
  { href: '/', label: 'Overview', group: 'Discover', icon: PanelsTopLeft },
  { href: '/jobs', label: 'Jobs', group: 'Discover', icon: Briefcase },
  { href: '/sources', label: 'Sources', group: 'Discover', icon: Activity },
  { href: '/saved', label: 'Saved searches', group: 'Discover', icon: Inbox },
  { href: '/applications', label: 'Applications', group: 'Track', icon: ClipboardList },
  { href: '/pipeline', label: 'Pipeline', group: 'Track', icon: ListChecks },
  { href: '/followups', label: 'Followups', group: 'Track', icon: Send },
  { href: '/jds', label: 'JD library', group: 'Prep', icon: Library },
  { href: '/reports', label: 'Reports', group: 'Prep', icon: FileText },
  { href: '/outputs', label: 'Outputs', group: 'Prep', icon: FileText },
  { href: '/interview-prep', label: 'Interview prep', group: 'Prep', icon: Sparkles },
  { href: '/stories', label: 'Story bank', group: 'Prep', icon: Library },
  { href: '/compare', label: 'Compare offers', group: 'Analyze', icon: GitCompare },
  { href: '/patterns', label: 'Patterns', group: 'Analyze', icon: FlaskConical },
  { href: '/analytics', label: 'Analytics', group: 'Analyze', icon: BarChart3 },
  { href: '/run', label: 'Run command', group: 'Infra', icon: Play },
  { href: '/settings', label: 'Settings', group: 'Infra', icon: Settings },
];

function CommandPaletteUi({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  if (!open) return null;

  const groups = Array.from(new Set(ROUTES.map((r) => r.group)));

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-start justify-center pt-[14vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm animate-in fade-in" />
      <div
        className="relative w-full max-w-xl glass-strong rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <CmdK label="Command palette" className="w-full">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <CmdK.Input
              autoFocus
              placeholder="Jump to page, run command…"
              className="flex h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border/70 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ESC
            </kbd>
          </div>
          <CmdK.List className="max-h-[60vh] overflow-y-auto p-1">
            <CmdK.Empty className="py-8 text-center text-sm text-muted-foreground">
              No matches.
            </CmdK.Empty>
            {groups.map((g) => (
              <CmdK.Group
                key={g}
                heading={g}
                className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {ROUTES.filter((r) => r.group === g).map((r) => {
                  const Icon = r.icon;
                  return (
                    <CmdK.Item
                      key={r.href}
                      value={`${r.label} ${r.group}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(r.href);
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{r.label}</span>
                    </CmdK.Item>
                  );
                })}
              </CmdK.Group>
            ))}
          </CmdK.List>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="rounded border border-border/70 bg-muted px-1 py-0.5 font-mono">↑↓</kbd>
              navigate
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border border-border/70 bg-muted px-1 py-0.5 font-mono">↵</kbd>
              open
            </div>
          </div>
        </CmdK>
      </div>
    </div>
  );
}
