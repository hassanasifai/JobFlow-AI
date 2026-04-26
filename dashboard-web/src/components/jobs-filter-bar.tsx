'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Search, Filter, X } from 'lucide-react';
import { REGION_OPTIONS } from '@/lib/format';
import { cn } from '@/lib/utils';

export type JobsFilterState = {
  q: string;
  regions: string[];
  sources: string[];
  sinceDays: number | null;
  remote: boolean | null;
};

export const EMPTY_FILTER: JobsFilterState = {
  q: '',
  regions: [],
  sources: [],
  sinceDays: null,
  remote: null,
};

const SINCE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Remote only' },
  { value: 'false', label: 'On-site only' },
];

export function JobsFilterBar({
  value,
  onChange,
  sourceOptions,
  total,
}: {
  value: JobsFilterState;
  onChange: (patch: Partial<JobsFilterState>) => void;
  sourceOptions: { id: string; label: string }[];
  total?: number;
}) {
  const hasActive = value.regions.length > 0 || value.sources.length > 0 || value.sinceDays != null || value.remote != null || value.q.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search by title or company…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={value.sinceDays ? String(value.sinceDays) : ''} onValueChange={(v) => onChange({ sinceDays: v ? Number(v) : null })}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Any time" /></SelectTrigger>
            <SelectContent>
              {SINCE_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'any'} value={o.value || '__any'}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={value.remote === true ? 'true' : value.remote === false ? 'false' : 'any'}
            onValueChange={(v) => onChange({ remote: v === 'true' ? true : v === 'false' ? false : null })}
          >
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REMOTE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MultiPicker
            label="Region"
            options={REGION_OPTIONS}
            selected={value.regions}
            onChange={(regions) => onChange({ regions })}
          />
          <MultiPicker
            label="Source"
            options={sourceOptions.map((s) => ({ value: s.id, label: s.label }))}
            selected={value.sources}
            onChange={(sources) => onChange({ sources })}
          />
          {hasActive && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => onChange(EMPTY_FILTER)}>
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
        </div>
      </div>
      {typeof total === 'number' && (
        <div className="text-xs text-muted-foreground">
          {total.toLocaleString()} job{total === 1 ? '' : 's'} match{total === 1 ? 'es' : ''} the current filter
        </div>
      )}
    </div>
  );
}

function MultiPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((s) => s !== v));
    else onChange([...selected, v]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-1', selected.length > 0 && 'border-primary text-primary')}>
          <Filter className="h-3.5 w-3.5" />
          {label}
          {selected.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5">{selected.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {options.length === 0 && <div className="text-sm text-muted-foreground">No options</div>}
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={() => toggle(o.value)}
              />
              <Label className="cursor-pointer flex-1">{o.label}</Label>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
