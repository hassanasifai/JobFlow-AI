'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home, Briefcase, FilePlus2, ClipboardList, FileText, FileDown,
  Activity, Bookmark, Radio, TrendingUp, Bell, Library, Settings, Terminal,
  MessageCircle, Scale, FolderOpen, ChartLine,
} from 'lucide-react';

// Order matches the daily workflow: discover → triage → evaluate → prep →
// polish → analyze → settings. Sub-groups are visually separated by
// `groupTop` boundaries which render a small spacer.
const NAV = [
  // — Discover —
  { href: '/', label: 'Home', icon: Home },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/pipeline', label: 'Pipeline', icon: FilePlus2 },
  { href: '/jds', label: 'JDs library', icon: FolderOpen },
  // — Track —
  { href: '/applications', label: 'Applications', icon: ClipboardList, groupTop: true },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/outputs', label: 'Outputs', icon: FileDown },
  // — Prep —
  { href: '/interview-prep', label: 'Interview prep', icon: MessageCircle, groupTop: true },
  { href: '/stories', label: 'Stories', icon: Library },
  { href: '/compare', label: 'Compare offers', icon: Scale },
  // — Analyze —
  { href: '/patterns', label: 'Patterns', icon: TrendingUp, groupTop: true },
  { href: '/followups', label: 'Follow-ups', icon: Bell },
  { href: '/analytics', label: 'Analytics', icon: ChartLine },
  // — Infra —
  { href: '/sources', label: 'Sources', icon: Activity, groupTop: true },
  { href: '/saved', label: 'Saved', icon: Bookmark },
  { href: '/run', label: 'Commands', icon: Terminal },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col md:w-60 border-r bg-muted/30">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Radio className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="font-semibold leading-tight text-sm">Career-Ops</div>
          <div className="text-[10px] text-muted-foreground">Job discovery</div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <div key={item.href} className={cn(item.groupTop && 'mt-3 pt-2 border-t border-border/40')}>
              <Link
                href={item.href}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'hover:bg-muted text-foreground/80 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-primary')} />
                <span className="font-medium">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t text-[10px] text-muted-foreground">
        <div>Career-Ops Web Console</div>
        <div className="opacity-70">Single-user · localhost</div>
      </div>
    </aside>
  );
}
