// scanners/agents/_base.mjs
//
// ModelProvider type definition + helpers shared between providers.
// Re-exports prompt helpers so callers can `import { ... } from '../agents'`.

export * from './_prompt.mjs';

/**
 * @typedef {object} TokenEvent
 * @property {string} chunk             new text fragment from the model
 * @property {number} tokenIndex        sequential index within the response
 * @property {string} [event]           reserved for typed SSE events
 */

/**
 * @typedef {object} RunRequest
 * @property {string} system            full system prompt
 * @property {string} user              user message (JD + extras)
 * @property {AbortSignal} [signal]
 * @property {(t: TokenEvent) => void} [onToken]   streaming callback
 * @property {number} [maxOutputTokens] default 8192
 * @property {number} [temperature]     default 0.4
 * @property {string} [model]           override per call (e.g. gpt-4o vs gpt-4o-mini)
 */

/**
 * @typedef {object} RunResult
 * @property {string} text              full text response
 * @property {string} model             actual model id used
 * @property {string} family            'claude' | 'gemini' | 'openai'
 * @property {{ inputTokens?: number, outputTokens?: number }} [usage]
 * @property {number} durationMs
 */

/**
 * @typedef {object} Availability
 * @property {boolean} available
 * @property {string} [reason]
 * @property {string} [hint]            actionable next step ("set OPENAI_API_KEY")
 */

/**
 * @typedef {object} ModelProvider
 * @property {string} id                stable identifier — used in URLs/configs
 * @property {string} label             human-friendly name
 * @property {'claude'|'gemini'|'openai'} family
 * @property {string} defaultModel
 * @property {() => Promise<Availability>} available
 * @property {(req: RunRequest) => Promise<RunResult>} run
 * @property {boolean} [costsMoney]     true for OpenAI; UI shows a notice
 */

/**
 * Convenience: bind onToken without forcing every provider to write the same
 * try/catch. Used by providers that emit a single final response (no
 * streaming) — fakes a single-chunk callback so the UI still shows progress.
 */
export function emitFakeStream(text, onToken) {
  if (!onToken) return;
  // Chunk by paragraph so the UI feels responsive even on non-streaming
  // providers. Single emit on tiny outputs.
  const chunks = text.length < 800 ? [text] : text.split(/\n\n+/);
  let index = 0;
  for (const chunk of chunks) {
    onToken({ chunk: chunk + (index < chunks.length - 1 ? '\n\n' : ''), tokenIndex: index++ });
  }
}

/**
 * Standard error class for provider failures. The web-server catches this,
 * formats a clean SSE `error` event, and surfaces a useful toast in the UI.
 */
export class ProviderError extends Error {
  constructor(providerId, message, { retriable = false, hint } = {}) {
    super(`[${providerId}] ${message}`);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.retriable = retriable;
    this.hint = hint;
  }
}
