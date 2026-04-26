'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, AgentProvider } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CircleAlert, DollarSign, CheckCircle2, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Model picker — shared by the Evaluate, Generate-PDF, Draft-Answers, and
 * Deep-Research dialogs. Single source of truth for which providers exist
 * and whether they're usable right now.
 *
 * Behavior:
 *   - Renders a Select with one option per known provider.
 *   - Unavailable providers are visible but disabled, with a tooltip
 *     surfacing the reason + actionable hint (set GEMINI_API_KEY, install
 *     Claude Code, run `npm install openai`, etc.).
 *   - The first available provider is auto-selected when `value` is null.
 *   - Costs-money providers (OpenAI today) get a $ badge so the user
 *     sees the warning before clicking submit.
 */
export function ModelPicker({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents,
    // Availability rarely changes within a session; cache for 5 min.
    staleTime: 5 * 60_000,
  });

  const providers = useMemo<AgentProvider[]>(() => data || [], [data]);
  const firstAvailable = providers.find((p) => p.available);

  // Auto-select on first load.
  useEffect(() => {
    if (!value && firstAvailable) onChange(firstAvailable.id);
  }, [value, firstAvailable, onChange]);

  return (
    <Select value={value || ''} onValueChange={onChange} disabled={isLoading || providers.length === 0}>
      <SelectTrigger className={cn('w-[260px]', className)}>
        <SelectValue placeholder={isLoading ? 'Loading…' : 'Pick a model'} />
      </SelectTrigger>
      <SelectContent>
        {providers.map((p) => (
          <ModelOption key={p.id} provider={p} />
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelOption({ provider }: { provider: AgentProvider }) {
  return (
    <SelectItem value={provider.id} disabled={!provider.available}>
      <div className="flex items-center gap-2 min-w-0">
        <Bot className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{provider.label}</span>
        {provider.costsMoney && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span><DollarSign className="h-3 w-3 text-amber-500" /></span>
            </TooltipTrigger>
            <TooltipContent>Costs money — billed to your OpenAI account</TooltipContent>
          </Tooltip>
        )}
        {provider.available ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span><CircleAlert className="h-3 w-3 text-muted-foreground" /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="font-medium">{provider.reason || 'Unavailable'}</div>
              {provider.hint && <div className="text-xs mt-1 text-muted-foreground">{provider.hint}</div>}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </SelectItem>
  );
}

/**
 * Inline status pill — useful in headers / footers when we want to show
 * "running on: Gemini 2.0 Flash" without a full picker.
 */
export function ModelBadge({ providerId }: { providerId: string | null | undefined }) {
  const { data } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents,
    staleTime: 5 * 60_000,
  });
  if (!providerId) return null;
  const p = (data || []).find((x) => x.id === providerId);
  if (!p) return <Badge variant="outline" className="text-[10px]">{providerId}</Badge>;
  return (
    <Badge variant="outline" className="text-[10px] gap-1">
      <Bot className="h-3 w-3" />
      {p.label}
      {p.costsMoney && <DollarSign className="h-3 w-3 text-amber-500" />}
    </Badge>
  );
}
