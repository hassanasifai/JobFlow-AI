'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Bookmark, ClipboardCheck, MessageSquare, Calendar, Award, X, Slash } from 'lucide-react';
import Link from 'next/link';

type State = {
  saved: boolean;
  processed: boolean;
  applicationNumber: number | null;
  applicationStatus: string | null;
};

/**
 * Compact badge that surfaces a job's relationship to the user's tracker.
 * Reads from `useOverviewLookup` upstream — render-cheap, just maps state to
 * an icon + label + color.
 *
 * Priority order:
 *   1. application status (Applied / Interview / Offer / …) — most informative
 *   2. saved-to-pipeline (pending) — light triage signal
 *   3. saved-to-pipeline (processed) — already evaluated, didn't apply
 *   4. nothing — render nothing
 */
export function JobStateBadge({
  state,
  variant = 'inline',
}: {
  state: State;
  variant?: 'inline' | 'row';
}) {
  if (state.applicationStatus) {
    const config = configForApplicationStatus(state.applicationStatus);
    const Icon = config.icon;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/dashboard/applications"
            className="no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            <Badge variant={variant === 'inline' ? 'default' : 'secondary'} className={config.classes}>
              <Icon className="h-3 w-3 mr-1" />
              {state.applicationStatus}
            </Badge>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Open application #{state.applicationNumber} in tracker</TooltipContent>
      </Tooltip>
    );
  }
  if (state.saved && !state.processed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
            <Bookmark className="h-3 w-3" />
            Saved
          </Badge>
        </TooltipTrigger>
        <TooltipContent>In your pipeline (pending)</TooltipContent>
      </Tooltip>
    );
  }
  if (state.processed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-muted-foreground">
            <Slash className="h-3 w-3" />
            Processed
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Already evaluated; not actioned</TooltipContent>
      </Tooltip>
    );
  }
  return null;
}

function configForApplicationStatus(status: string): {
  icon: React.ComponentType<{ className?: string }>;
  classes: string;
} {
  switch (status) {
    case 'Applied':
      return { icon: ClipboardCheck, classes: 'text-[10px] px-1.5 py-0 gap-1 bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20' };
    case 'Responded':
      return { icon: MessageSquare, classes: 'text-[10px] px-1.5 py-0 gap-1 bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20' };
    case 'Interview':
      return { icon: Calendar, classes: 'text-[10px] px-1.5 py-0 gap-1 bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30 hover:bg-violet-500/20' };
    case 'Offer':
      return { icon: Award, classes: 'text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20' };
    case 'Rejected':
    case 'Discarded':
    case 'SKIP':
      return { icon: X, classes: 'text-[10px] px-1.5 py-0 gap-1 text-muted-foreground' };
    default:
      return { icon: ClipboardCheck, classes: 'text-[10px] px-1.5 py-0 gap-1' };
  }
}
