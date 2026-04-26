// src/lib/api.ts
// Thin fetch wrapper. Every dashboard screen goes through this so we can:
//   - centralize error handling (HTTP status → toast)
//   - swap base URL between same-origin (prod) and proxied dev
//   - kill the boilerplate of "await fetch().json() with try/catch"
//
// The proxy in next.config.ts forwards /api/* to web-server.mjs in dev,
// so all screens use plain '/api/...' URLs and don't care about ports.

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const message = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

// ── Domain types — shaped to match web-server.mjs JSON exactly ────────

export type Job = {
  source: string;
  source_kind: string;
  source_id?: string;
  title: string;
  company: string;
  location: string;
  url: string;
  apply_url?: string | null;
  remote: boolean;
  remote_scope?: 'none' | 'country' | 'region' | 'worldwide';
  region_group?: string;
  country_code?: string | null;
  description?: string | null;
  description_html?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  employment_type?: string | null;
  posted_at?: string | null;
  date_posted?: string | null;
  expires_at?: string | null;
  tags?: string[];
  _scanned_at?: string;
};

export type JobsResponse = {
  total: number;
  offset: number;
  limit: number;
  filters: {
    regions: string[];
    sources: string[];
    sinceDays: number | null;
    query: string;
    remote: boolean | null;
  };
  items: Job[];
};

export type Adapter = {
  id: string;
  kind: string;
  file?: string;
  regions: string[];
  requiresKey: boolean;
  requiresKeySatisfied: boolean;
  envKeys: string[];
  missingEnv: string[];
  enabledInConfig?: boolean;
  unavailable?: boolean;
  supports?: Record<string, boolean>;
  presets?: Record<string, string[]>;
  schema?: Record<string, string>;
  docs?: string | null;
  warning?: string | null;
};

export type ProbeSample = {
  title: string;
  url: string;
  company: string | null;
  location: string | null;
  posted_at: string | null;
};

export type SourceHealth = Adapter & {
  total: number;
  jobs_7d: number;
  last_seen_at: string | null;
  last_error: { error: string; at: string } | null;
  unavailable: boolean;
  requiresInputs: string[];
  missingInputs: string[];
  requiresAck: string | null;
  ackMissing: boolean;
  signupUrl: string | null;
  freeTier: string | null;
  status: 'healthy' | 'stale' | 'unavailable' | 'needs_config' | 'needs_inputs' | 'needs_ack' | 'error' | 'unknown';
  probe_sample: ProbeSample | null;
  probed_at: string | null;
};

export type ProbeResult = {
  ok: boolean;
  probe: {
    probed_at: string;
    duration_ms: number;
    total: number;
    ok: number;
    empty: number;
    errored: number;
    skipped: number;
    sources: Array<{ id: string; status: string; fetched: number; kept: number; sample: ProbeSample | null }>;
  } | null;
  stderr: string;
  durationMs: number;
};

export type SavedSearch = {
  id: string;
  name: string;
  region: string[];
  titles: string[];
  sources: string[];
  locations: string[];
  since_days: number | null;
  remote: boolean | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationRow = {
  number: number;
  date: string;
  company: string;
  role: string;
  score: number;          // numeric (0..5) — 0 means not scored
  scoreRaw: string;       // original "X.X/5" string
  status: string;         // canonical state from STATUS_OPTIONS
  pdf: boolean;
  reportPath: string;
  reportLabel: string;
  notes: string;
};

export type PipelineItem = {
  lineNumber: number;
  checked: boolean;
  url: string;
  company: string;
  role: string;
};

export type ReportFile = {
  name: string;
  path: string;          // relative to project root
  size: number;
  modifiedAt: string;
  url: string;           // /assets/... served by web-server.mjs
};

export type CommandSpec = {
  id: string;
  label: string;
  description: string;
};

export type SetupCheck = {
  path: string;
  present: boolean;
  fix: string;
};

export type Overview = {
  setup: { ready: boolean; checks: SetupCheck[] };
  metrics: {
    totalApplications: number;
    pendingPipeline: number;
    avgScore: number;
    withPdf: number;
    totalReports: number;
    totalOutputs: number;
    byStatus: Record<string, number>;
  };
  statusOptions: string[];
  commands: CommandSpec[];
  editableFiles: string[];
  applications: ApplicationRow[];
  pipeline: PipelineItem[];
  pipelineItems: { pending: PipelineItem[]; processed: PipelineItem[]; total: number };
  reports: ReportFile[];
  outputs: ReportFile[];
  generatedAt: string;
};

export type CommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timeout: boolean;
  command?: string;
  label?: string;
};

export type AgentProvider = {
  id: 'claude-code' | 'gemini' | 'openai' | string;
  label: string;
  family: 'claude' | 'gemini' | 'openai' | string;
  defaultModel: string;
  costsMoney: boolean;
  available: boolean;
  reason?: string;
  hint?: string;
};

export type ScanProgressEntry = {
  state: 'pending' | 'running' | 'ok' | 'failed';
  fetched?: number;
  kept?: number;
  ms?: number;
  error?: string;
};

export type ScanJobView = {
  job_id: string;
  state: 'queued' | 'running' | 'done' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  request: unknown;
  progress: Record<string, ScanProgressEntry>;
  counts: { found: number; new: number; dedup: number; dedup_role?: number };
  errors: { id: string; error: string }[];
  skipped: { id: string; reason: string; detail?: string; missing?: string[] }[];
  stats?: { id: string; fetched: number; kept: number; ms: number; error?: string }[];
};

// ── Endpoint helpers ────────────────────────────────────────────────────

export const api = {
  jobs(params: {
    region?: string[];
    source?: string[];
    q?: string;
    sinceDays?: number | null;
    remote?: boolean | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<JobsResponse> {
    const sp = new URLSearchParams();
    if (params.region?.length) sp.set('region', params.region.join(','));
    if (params.source?.length) sp.set('source', params.source.join(','));
    if (params.q) sp.set('q', params.q);
    if (params.sinceDays) sp.set('since', String(params.sinceDays));
    if (params.remote === true) sp.set('remote', 'true');
    if (params.remote === false) sp.set('remote', 'false');
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.offset) sp.set('offset', String(params.offset));
    const qs = sp.toString();
    return request(`/api/jobs${qs ? `?${qs}` : ''}`);
  },

  scanners(): Promise<Adapter[]> {
    return request('/api/scanners');
  },

  sourcesProbe(): Promise<ProbeResult> {
    return request('/api/sources/probe', { method: 'POST' });
  },

  sourcesHealth(): Promise<SourceHealth[]> {
    return request('/api/sources/health');
  },

  listSavedSearches(): Promise<{ items: SavedSearch[] }> {
    return request('/api/saved-searches');
  },

  upsertSavedSearch(body: Partial<SavedSearch> & { id: string; name: string }): Promise<SavedSearch> {
    return request('/api/saved-searches', { method: 'POST', body: JSON.stringify(body) });
  },

  deleteSavedSearch(id: string): Promise<{ ok: true; id: string }> {
    return request(`/api/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  startScan(body: {
    sources?: string[];
    query?: { titles?: string[]; regions?: string[]; locations?: string[]; companies?: string[]; remote?: boolean };
    dry_run?: boolean;
    persist?: boolean;
    concurrency?: number;
    include_disabled?: boolean;
  }): Promise<ScanJobView> {
    return request('/api/scan/run', { method: 'POST', body: JSON.stringify(body) });
  },

  scanStatus(id: string): Promise<ScanJobView> {
    return request(`/api/scan/status/${encodeURIComponent(id)}`);
  },

  scanResults(id: string, opts: { limit?: number; offset?: number } = {}): Promise<{
    job_id: string;
    state: string;
    total: number;
    offset: number;
    limit: number;
    items: Job[];
  }> {
    const sp = new URLSearchParams();
    if (opts.limit) sp.set('limit', String(opts.limit));
    if (opts.offset) sp.set('offset', String(opts.offset));
    const qs = sp.toString();
    return request(`/api/scan/results/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
  },

  geminiEval(text: string): Promise<CommandResult> {
    return request('/api/gemini-eval', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  // ── Career-ops workflow endpoints ─────────────────────────────────

  overview(): Promise<Overview> {
    return request('/api/overview');
  },

  reportContent(path: string): Promise<{ path: string; content: string }> {
    return request(`/api/report?path=${encodeURIComponent(path)}`);
  },

  setApplicationStatus(number: number, status: string): Promise<{ ok: true; overview: Overview }> {
    return request('/api/status', {
      method: 'POST',
      body: JSON.stringify({ number, status }),
    });
  },

  setApplicationNotes(number: number, notes: string): Promise<{ ok: true; overview: Overview }> {
    return request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ number, notes }),
    });
  },

  createApplication(body: {
    company: string;
    role: string;
    status?: string;
    score?: number;
    url?: string;
    notes?: string;
    pdf?: boolean;
    report_path?: string;
    allow_duplicate?: boolean;
  }): Promise<{ ok: true; number: number; overview: Overview }> {
    return request('/api/applications', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  pipelineAdd(body: { url: string; company?: string; role?: string }): Promise<{ ok: true; overview: Overview }> {
    return request('/api/pipeline/add', { method: 'POST', body: JSON.stringify(body) });
  },

  pipelineToggle(lineNumber: number, checked: boolean): Promise<{ ok: true; overview: Overview }> {
    return request('/api/pipeline/toggle', {
      method: 'POST',
      body: JSON.stringify({ lineNumber, checked }),
    });
  },

  pipelineRemove(lineNumber: number): Promise<{ ok: true; overview: Overview }> {
    return request('/api/pipeline/remove', {
      method: 'POST',
      body: JSON.stringify({ lineNumber }),
    });
  },

  runCommand(commandId: string): Promise<CommandResult> {
    return request('/api/command', {
      method: 'POST',
      body: JSON.stringify({ command: commandId }),
    });
  },

  liveness(urls: string[]): Promise<CommandResult> {
    return request('/api/liveness', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    });
  },

  // ── Editable config ────────────────────────────────────────────────

  configList(): Promise<{ files: { path: string; exists: boolean; size: number }[] }> {
    return request('/api/config');
  },

  configRead(path: string): Promise<{ path: string; exists: boolean; content: string }> {
    return request(`/api/config?path=${encodeURIComponent(path)}`);
  },

  configWrite(path: string, content: string): Promise<{ ok: true; path: string; bytes: number; overview: Overview }> {
    return request('/api/config', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  },

  agents(): Promise<AgentProvider[]> {
    return request('/api/agents');
  },

  listJds(): Promise<{ items: { name: string; path: string; size: number; modifiedAt: string }[] }> {
    return request('/api/jds');
  },

  readJd(path: string): Promise<{ path: string; content: string }> {
    return request(`/api/jds/read?path=${encodeURIComponent(path)}`);
  },

  generateLatex(body: { tex_path: string; output_pdf?: string }): Promise<{
    ok: boolean;
    error?: string;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
  }> {
    return request('/api/generate-latex', { method: 'POST', body: JSON.stringify(body) });
  },

  generatePdf(body: { html_path?: string; output_path?: string }): Promise<{
    ok: boolean;
    output?: string;
    error?: string;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
  }> {
    return request('/api/generate-pdf', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

// ── SSE streaming for /api/evaluate, /api/draft-application, etc. ──────

export type StreamStageEvent = { type: 'stage'; stage: string; label: string };
export type StreamProgressEvent = { type: 'progress'; chars: number };
export type StreamCvDoneEvent = {
  type: 'done';
  html_path: string;
  pdf_path: string;
  candidate: string;
  company: string;
  paper: 'letter' | 'a4';
  size_bytes: number;
  provider: string;
  duration_ms: number;
  pdf_stdout?: string;
};
export type StreamTokenEvent = { type: 'token'; chunk: string; i: number };
export type StreamDoneEvent = {
  type: 'done';
  text: string;
  summary: {
    company: string;
    role: string;
    score: number | null;
    scoreRaw: string | null;
    archetype: string | null;
    legitimacy: string | null;
  } | null;
  report_path: string | null;
  model: string;
  provider: string;
  duration_ms: number;
};
export type StreamErrorEvent = { type: 'error'; message: string; hint?: string; provider?: string; stage?: string; preview?: string; stderr?: string };
export type StreamWarningEvent = { type: 'warning'; message: string; stage?: string };
export type StreamEvent =
  | StreamTokenEvent
  | StreamDoneEvent
  | StreamCvDoneEvent
  | StreamStageEvent
  | StreamProgressEvent
  | StreamErrorEvent
  | StreamWarningEvent;

/**
 * Open an SSE stream against an agent endpoint and yield events.
 *
 * Implements the minimal SSE wire format the backend sends — `event:` line
 * followed by one `data:` line per record. We don't depend on EventSource
 * because (a) it can't POST and (b) we want explicit control over
 * cancellation. Uses fetch's streaming body (Response.body) which works in
 * every modern browser.
 */
export async function* streamAgent(
  endpoint:
    | '/api/evaluate'
    | '/api/draft-application'
    | '/api/deep-research'
    | '/api/contacto'
    | '/api/generate-cv'
    | '/api/eval-training'
    | '/api/eval-project'
    | '/api/interview-prep'
    | '/api/draft-followup'
    | '/api/compare-offers',
  body: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): AsyncGenerator<StreamEvent, void, unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
  if (!res.ok) {
    let detail: { error?: string; hint?: string } = {};
    try { detail = await res.json(); } catch { /* swallow */ }
    yield { type: 'error', message: detail.error || `HTTP ${res.status}`, hint: detail.hint };
    return;
  }
  if (!res.body) {
    yield { type: 'error', message: 'No response body' };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Split on the SSE record terminator (\n\n).
    let recordEnd: number;
    while ((recordEnd = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, recordEnd);
      buffer = buffer.slice(recordEnd + 2);
      const evt = parseSSERecord(record);
      if (evt) yield evt;
    }
  }
}

function parseSSERecord(record: string): StreamEvent | null {
  let event = '';
  let data = '';
  for (const line of record.split('\n')) {
    if (line.startsWith(':')) continue;                 // SSE comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
  }
  if (!event || !data) return null;
  try {
    const payload = JSON.parse(data);
    return { type: event, ...payload } as StreamEvent;
  } catch {
    return null;
  }
}
