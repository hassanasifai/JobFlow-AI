// src/lib/format.ts — UI-only formatters. Keep pure & dependency-free.

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? '' : 'in ';
  const unit = (n: number, label: string) =>
    `${sign}${Math.round(n)} ${label}${Math.round(n) === 1 ? '' : 's'}${diff >= 0 ? ' ago' : ''}`;
  if (abs < 60_000) return diff >= 0 ? 'just now' : 'soon';
  if (abs < 3_600_000) return unit(abs / 60_000, 'minute');
  if (abs < 86_400_000) return unit(abs / 3_600_000, 'hour');
  if (abs < 604_800_000) return unit(abs / 86_400_000, 'day');
  if (abs < 2_592_000_000) return unit(abs / 604_800_000, 'week');
  if (abs < 31_536_000_000) return unit(abs / 2_592_000_000, 'month');
  return unit(abs / 31_536_000_000, 'year');
}

const REGION_LABELS: Record<string, string> = {
  pakistan: 'Pakistan',
  gcc: 'Gulf / GCC',
  ireland: 'Ireland',
  poland: 'Poland',
  usa: 'USA',
  uk: 'UK',
  europe: 'Europe',
  remote_worldwide: 'Remote · worldwide',
  remote_region: 'Remote · region',
  other: 'Other',
};

export function regionLabel(group: string | null | undefined): string {
  return REGION_LABELS[group || ''] || group || 'Unknown';
}

export const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'pakistan', label: 'Pakistan' },
  { value: 'gcc', label: 'Gulf / GCC' },
  { value: 'remote_worldwide', label: 'Remote · worldwide' },
  { value: 'remote_region', label: 'Remote · region' },
  { value: 'europe', label: 'Europe' },
  { value: 'uk', label: 'UK' },
  { value: 'usa', label: 'USA' },
  { value: 'ireland', label: 'Ireland' },
  { value: 'poland', label: 'Poland' },
  { value: 'other', label: 'Other' },
];

export function statusColor(status: string): string {
  switch (status) {
    case 'healthy': return 'bg-emerald-500';
    case 'stale': return 'bg-amber-500';
    case 'error': return 'bg-red-500';
    case 'unavailable': return 'bg-zinc-400';
    case 'needs_config': return 'bg-blue-500';
    case 'needs_inputs': return 'bg-violet-500';
    case 'needs_ack': return 'bg-orange-500';
    default: return 'bg-zinc-300';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'healthy': return 'Healthy';
    case 'stale': return 'No recent jobs';
    case 'error': return 'Errors';
    case 'unavailable': return 'Unavailable';
    case 'needs_config': return 'Needs API key';
    case 'needs_inputs': return 'Needs companies / URLs';
    case 'needs_ack': return 'Needs ToS acknowledgement';
    default: return 'No data';
  }
}
