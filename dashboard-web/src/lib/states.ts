// Canonical application states — must match STATUS_OPTIONS in web-server.mjs.
// Order is the typical funnel order so kanban columns read left-to-right.

export const STATUS_OPTIONS = [
  'Evaluated',
  'Applied',
  'Responded',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
  'SKIP',
] as const;

export type Status = typeof STATUS_OPTIONS[number];

export const STATUS_COLOR: Record<Status, string> = {
  Evaluated: 'bg-zinc-400',
  Applied: 'bg-blue-500',
  Responded: 'bg-cyan-500',
  Interview: 'bg-violet-500',
  Offer: 'bg-emerald-500',
  Rejected: 'bg-red-500',
  Discarded: 'bg-zinc-500',
  SKIP: 'bg-zinc-300',
};

// Light-mode tint for status column backgrounds.
export const STATUS_TINT: Record<Status, string> = {
  Evaluated: 'bg-zinc-100/50 dark:bg-zinc-800/30',
  Applied: 'bg-blue-100/40 dark:bg-blue-950/20',
  Responded: 'bg-cyan-100/40 dark:bg-cyan-950/20',
  Interview: 'bg-violet-100/40 dark:bg-violet-950/20',
  Offer: 'bg-emerald-100/40 dark:bg-emerald-950/20',
  Rejected: 'bg-red-100/30 dark:bg-red-950/20',
  Discarded: 'bg-zinc-100/30 dark:bg-zinc-900/30',
  SKIP: 'bg-zinc-100/30 dark:bg-zinc-900/20',
};
