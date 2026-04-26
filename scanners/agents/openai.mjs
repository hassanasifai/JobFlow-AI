// scanners/agents/openai.mjs
//
// OpenAI provider — uses the official `openai` SDK. Streaming via the chat
// completions API (responses API has the same shape but a heavier dep
// surface). Defaults to gpt-4o-mini for cost reasons; user can override per
// call from the model picker.
//
// IMPORTANT: this provider costs money. The UI surfaces a "this will charge
// your account" notice via meta.costsMoney.

import { ProviderError } from './_base.mjs';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const openai = {
  id: 'openai',
  label: 'GPT-4o-mini',
  family: 'openai',
  defaultModel: DEFAULT_MODEL,
  costsMoney: true,

  async available() {
    if (!process.env.OPENAI_API_KEY) {
      return {
        available: false,
        reason: 'OPENAI_API_KEY not set',
        hint: 'Add OPENAI_API_KEY=sk-… to .env. This provider costs money — see https://platform.openai.com/usage',
      };
    }
    // Lazily resolve the SDK so users without it installed see the missing-dep
    // error with a clear hint.
    try {
      await import('openai');
    } catch {
      return {
        available: false,
        reason: 'openai SDK not installed',
        hint: 'Run `npm install openai` in the project root',
      };
    }
    return { available: true };
  },

  async run({ system, user, onToken, signal, maxOutputTokens = 8192, temperature = 0.4, model }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ProviderError('openai', 'OPENAI_API_KEY missing');

    let OpenAI;
    try { ({ default: OpenAI } = await import('openai')); }
    catch { throw new ProviderError('openai', 'openai SDK not installed', { hint: 'npm install openai' }); }

    const client = new OpenAI({ apiKey });
    const modelName = model || DEFAULT_MODEL;

    const t0 = Date.now();
    let combined = '';
    let usage;
    try {
      const stream = await client.chat.completions.create({
        model: modelName,
        // OpenAI uses an explicit system message turn rather than a separate
        // field — slot the system prompt as the first message.
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_completion_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      });
      let i = 0;
      for await (const event of stream) {
        if (signal?.aborted) throw new ProviderError('openai', 'aborted', { retriable: true });
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          combined += delta;
          onToken?.({ chunk: delta, tokenIndex: i++ });
        }
        if (event.usage) {
          usage = {
            inputTokens: event.usage.prompt_tokens,
            outputTokens: event.usage.completion_tokens,
          };
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const msg = String(err?.message || err);
      if (/api key|authentication|unauthor/i.test(msg)) {
        throw new ProviderError('openai', 'API key rejected', { hint: 'Check OPENAI_API_KEY in .env' });
      }
      if (/rate.?limit|quota|insufficient/i.test(msg)) {
        throw new ProviderError('openai', msg, { retriable: true, hint: 'Wait or check usage at platform.openai.com' });
      }
      throw new ProviderError('openai', msg);
    }

    return {
      text: combined,
      model: modelName,
      family: 'openai',
      usage,
      durationMs: Date.now() - t0,
    };
  },
};

export default openai;
