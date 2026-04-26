'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import {
  Home, Briefcase, FilePlus2, ClipboardList, FileText, FileDown,
  Activity, Bookmark, TrendingUp, Bell, Library, Settings, Terminal,
  MessageCircle, Scale, FolderOpen, ChartLine, Sparkles,
} from 'lucide-react';

// Section-grouped navigation. Each group has a small uppercase header.
// Active state uses cyan accent + glowing underline + soft glass background.
const SECTIONS: Array<{ heading: string; items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }> }> = [
  {
    heading: 'Discover',
    items: [
      { href: '/', label: 'Overview', icon: Home },
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/sources', label: 'Sources', icon: Activity },
      { href: '/saved', label: 'Saved searches', icon: Bookmark },
    ],
  },
  {
    heading: 'Track',
    items: [
      { href: '/applications', label: 'Applications', icon: ClipboardList },
      { href: '/pipeline', label: 'Pipeline', icon: FilePlus2 },
      { href: '/followups', label: 'Follow-ups', icon: Bell },
    ],
  },
  {
    heading: 'Prep',
    items: [
      { href: '/jds', label: 'JD library', icon: FolderOpen },
      { href: '/reports', label: 'Reports', icon: FileText },
      { href: '/outputs', label: 'Outputs', icon: FileDown },
      { href: '/interview-prep', label: 'Interview prep', icon: MessageCircle },
      { href: '/stories', label: 'Story bank', icon: Library },
    ],
  },
  {
    heading: 'Analyze',
    items: [
      { href: '/compare', label: 'Compare offers', icon: Scale },
      { href: '/patterns', label: 'Patterns', icon: TrendingUp },
      { href: '/analytics', label: 'Analytics', icon: ChartLine },
    ],
  },
  {
    heading: 'Infra',
    items: [
      { href: '/run', label: 'Run command', icon: Terminal },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="relative z-10 hidden md:flex md:w-[15.5rem] md:flex-col border-r border-border/60 bg-card/40 backdrop-blur-md">
      {/* Brand header */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-brand-violet text-white shadow-lg shadow-primary/30">
          <Sparkles className="h-4 w-4" />
          <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/20" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm tracking-tight gradient-text">JobFlow AI</div>
          <div className="text-[10px] text-muted-foreground">Job-search command center</div>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="space-y-0.5">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {section.heading}
            </div>
            {section.items.map((item) => {
              const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {/* Active indicator: animated layout-id glides between items on route change */}
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-md bg-gradient-to-r from-primary/15 via-primary/8 to-transparent ring-1 ring-inset ring-primary/25"
                      transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                    />
                  )}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]"
                    />
                  )}
                  <Icon className={cn('relative h-4 w-4 shrink-0 transition-colors', active ? 'text-primary' : 'group-hover:text-foreground')} />
                  <span className="relative font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border/60 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-[breathe_3s_ease-in-out_infinite]" />
          Connected · localhost
        </div>
        <div className="mt-1 opacity-70">v1.0 · single-user</div>
      </div>
    </aside>
  );
}
