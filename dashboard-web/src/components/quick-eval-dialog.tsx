'use client';

import { useEffect, useRef, useState } from 'react';
import { streamAgent, StreamEvent } from '@/lib/api';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, AlertTriangle, Square } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { MarkdownView } from '@/components/markdown-view';
import { toast } from 'sonner';

/**
 * Generic streaming dialog for one-shot agent calls — Training evaluator,
 * Project evaluator, Outreach drafter, Interview prep, Follow-up drafter.
 *
 * The differentiator is the endpoint + how to compose the body. The dialog
 * itself is shape-agnostic: it shows a textarea, a model picker, and a live
 * markdown viewer for the streamed result.
 */
export function QuickEvalDialog({
  open,
  onOpenChange,
  endpoint,
  title,
  description,
  inputLabel,
  inputPlaceholder,
  buildBody,
  initialInput = '',
  minInputChars = 20,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: Parameters<typeof streamAgent>[0];
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  /** Compose request body from input + model. Return null/throw to cancel. */
  buildBody: (input: string, modelId: string) => Record<string, unknown> | null;
  initialInput?: string;
  minInputChars?: number;
}) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      acRef.current?.abort();
      setRunning(false);
      setText('');
      setError(null);
      return;
    }
    setInput(initialInput);
  }, [open, initialInput]);

  const start = async () => {
    if (!modelId) { toast.error('Pick a model first'); return; }
    if (input.trim().length < minInputChars) {
      toast.error(`Need at least ${minInputChars} characters`);
      return;
    }
    let body: Record<string, unknown> | null;
    try { body = buildBody(input, modelId); }
    catch (e) { toast.error((e as Error).message); return; }
    if (!body) return;

    setRunning(true);
    setText('');
    setError(null);
    const ac = new AbortController();
    acRef.current = ac;
    try {
      for await (const evt of streamAgent(endpoint, body, { signal: ac.signal })) {
        handleEvent(evt);
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(String((e as Error)?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const handleEvent = (evt: StreamEvent) => {
    if (evt.type === 'token') {
      setText((prev) => prev + evt.chunk);
    } else if (evt.type === 'done') {
      // Done events are end-of-stream; nothing to do (UI already shows the body).
    } else if (evt.type === 'error') {
      setError(`${evt.message}${evt.hint ? ` — ${evt.hint}` : ''}`);
      toast.error(evt.message, { description: evt.hint });
    } else if (evt.type === 'warning') {
      toast.warning(evt.message);
    }
  };

  const stop = () => acRef.current?.abort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1 -mr-1 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Model</Label>
            <ModelPicker value={modelId} onChange={setModelId} className="w-full" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="quick-input" className="text-xs flex items-center justify-between">
              <span>{inputLabel}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{input.length} chars</span>
            </Label>
            <textarea
              id="quick-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full min-h-[140px] resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={inputPlaceholder}
              spellCheck={false}
              disabled={running}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn&apos;t complete</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
            </Alert>
          )}

          {(running || text) && (
            <div className="border rounded-md bg-card flex flex-col overflow-hidden">
              <div className="px-3 py-1.5 border-b text-xs text-muted-foreground flex items-center gap-2">
                {running ? (<><Loader2 className="h-3 w-3 animate-spin" /> Streaming…</>) : (<><Sparkles className="h-3 w-3 text-emerald-500" /> Done</>)}
              </div>
              <ScrollArea className="max-h-[50vh]">
                <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                  <MarkdownView markdown={text || '_(awaiting tokens…)_'} />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 flex-wrap">
          {running ? (
            <Button onClick={stop} variant="destructive" className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button>
          ) : (
            <Button onClick={start} disabled={!modelId || input.trim().length < minInputChars} className="gap-1.5">
              <Sparkles className="h-4 w-4" /> {text ? 'Re-run' : 'Run'}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="ml-auto">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
