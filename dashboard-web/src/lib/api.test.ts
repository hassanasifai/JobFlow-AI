// streamAgent SSE consumer tests. Every dialog (Evaluate, CV Studio, Apply,
// Deep Research, Contacto, Interview Prep, Patterns, Followup) goes through
// streamAgent to talk to the backend, so a regression here breaks every
// agent-driven UI at once. High leverage per test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAgent, type StreamEvent } from './api';

// ── fetch stub helpers ────────────────────────────────────────────────

const realFetch = globalThis.fetch;

/**
 * Build a Response whose body is a ReadableStream that emits the chunks
 * passed in (already serialized as raw SSE bytes). Each chunk emits, then a
 * tiny await Promise.resolve() yields control so the consumer reads
 * incrementally — mimicking a real network stream rather than one big buffer.
 */
function sseResponse(...chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => { /* clean */ });
afterEach(() => { globalThis.fetch = realFetch; });

async function collect(gen: AsyncGenerator<StreamEvent, void, unknown>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ── tests ──────────────────────────────────────────────────────────────

describe('streamAgent', () => {
  it('parses a complete event stream into ordered events', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(
      ': stream-start\n\n',
      'event: token\ndata: {"chunk":"Hello, ","i":0}\n\n',
      'event: token\ndata: {"chunk":"world","i":1}\n\n',
      'event: done\ndata: {"text":"Hello, world","summary":{"score":4.2,"company":"Acme","role":"AI Engineer"},"report_path":"reports/001.md","duration_ms":1234}\n\n',
    ));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    expect(events).toHaveLength(3);
    const [first, second, done] = events;
    expect(first).toEqual({ type: 'token', chunk: 'Hello, ', i: 0 });
    expect(second).toEqual({ type: 'token', chunk: 'world', i: 1 });
    expect(done?.type).toBe('done');
    if (done && done.type === 'done' && 'summary' in done) {
      expect(done.summary?.score).toBe(4.2);
      expect(done.report_path).toBe('reports/001.md');
    }
  });

  it('handles records that span chunk boundaries (no double-fire, no truncation)', async () => {
    // Split a single SSE record across two underlying buffer reads. The
    // consumer must reassemble correctly via the internal buffer.
    globalThis.fetch = vi.fn(async () => sseResponse(
      'event: token\ndata: {"chu',                  // mid-record
      'nk":"split","i":42}\n\n',                    // record completes
      'event: done\ndata: {"text":"split","summary":null,"report_path":null,"duration_ms":1}\n\n',
    ));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    expect(events.filter((e) => e.type === 'token')).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'token', chunk: 'split', i: 42 });
  });

  it('ignores SSE comments (": keepalive\\n\\n") that the backend sends every 20s', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(
      ': keepalive\n\n',
      'event: token\ndata: {"chunk":"a","i":0}\n\n',
      ': keepalive\n\n',
      ': another comment\n\n',
      'event: done\ndata: {"text":"a","summary":null,"report_path":null,"duration_ms":1}\n\n',
    ));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    // Two real events, zero comment events.
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('token');
    expect(events[1]?.type).toBe('done');
  });

  it('emits a synthetic error event on 4xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'JD too short', hint: 'Paste at least 40 chars' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e?.type).toBe('error');
    if (e && e.type === 'error') {
      expect(e.message).toBe('JD too short');
      expect(e.hint).toBe('Paste at least 40 chars');
    }
  });

  it('emits a synthetic error event on 5xx with no JSON body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Internal', { status: 500 }));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    expect(events).toHaveLength(1);
    const [first] = events;
    expect(first?.type).toBe('error');
    if (first && first.type === 'error') {
      expect(first.message).toMatch(/HTTP 500|Internal/);
    }
  });

  it('discards malformed JSON inside an event without crashing the stream', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(
      'event: token\ndata: {bad json\n\n',                            // broken
      'event: token\ndata: {"chunk":"after","i":0}\n\n',              // good
      'event: done\ndata: {"text":"after","summary":null,"report_path":null,"duration_ms":1}\n\n',
    ));
    const events = await collect(streamAgent('/api/evaluate', { jd_text: 'x' }));
    // Only the well-formed token + done make it through.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'token', chunk: 'after' });
  });

  it('forwards the AbortSignal to fetch', async () => {
    const ac = new AbortController();
    let received: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      received = init?.signal as AbortSignal | undefined;
      return sseResponse('event: done\ndata: {"text":"","summary":null,"report_path":null,"duration_ms":0}\n\n');
    });
    await collect(streamAgent('/api/evaluate', { jd_text: 'x' }, { signal: ac.signal }));
    expect(received).toBe(ac.signal);
  });

  it('handles CV Studio done events with html_path/pdf_path shape (different from evaluate)', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(
      'event: stage\ndata: {"stage":"tailoring","label":"Asking…"}\n\n',
      'event: progress\ndata: {"chars":1234}\n\n',
      'event: stage\ndata: {"stage":"pdf","label":"Rendering…"}\n\n',
      'event: done\ndata: {"html_path":"output/cv.html","pdf_path":"output/cv.pdf","candidate":"jane","company":"acme","paper":"a4","size_bytes":12345,"provider":"gemini","duration_ms":5000}\n\n',
    ));
    const events = await collect(streamAgent('/api/generate-cv', {}));
    expect(events).toHaveLength(4);
    expect(events[0]?.type).toBe('stage');
    expect(events[1]?.type).toBe('progress');
    expect(events[2]?.type).toBe('stage');
    expect(events[3]?.type).toBe('done');
    const done = events[3];
    if (done && done.type === 'done' && 'pdf_path' in done) {
      expect(done.pdf_path).toBe('output/cv.pdf');
    }
  });
});
