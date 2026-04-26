// scanners/agents/gemini.mjs
//
// Gemini provider — wraps @google/generative-ai (already a dependency from
// the legacy gemini-eval.mjs flow). Uses streaming via generateContentStream
// so the UI can show tokens in real time.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProviderError } from './_base.mjs';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export const gemini = {
  id: 'gemini',
  label: 'Gemini 2.0 Flash',
  family: 'gemini',
  defaultModel: DEFAULT_MODEL,
  costsMoney: false,

  async available() {
    if (!process.env.GEMINI_API_KEY) {
      return {
        available: false,
        reason: 'GEMINI_API_KEY not set',
        hint: 'Get a free key at https://aistudio.google.com/apikey and add GEMINI_API_KEY=… to .env',
      };
    }
    return { available: true };
  },

  async run({ system, user, onToken, signal, maxOutputTokens = 8192, temperature = 0.4, model }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ProviderError('gemini', 'GEMINI_API_KEY missing');

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = model || DEFAULT_MODEL;
    const m = genAI.getGenerativeModel({
      model: modelName,
      // Gemini's system instruction is a separate field rather than a turn,
      // which is exactly what we want — keeps the user message clean.
      systemInstruction: system,
      generationConfig: { temperature, maxOutputTokens },
    });

    const t0 = Date.now();
    let combined = '';
    let usage;
    try {
      const stream = await m.generateContentStream(user);
      let i = 0;
      for await (const chunk of stream.stream) {
        if (signal?.aborted) throw new ProviderError('gemini', 'aborted', { retriable: true });
        const t = chunk.text();
        if (!t) continue;
        combined += t;
        onToken?.({ chunk: t, tokenIndex: i++ });
      }
      // Aggregate usage when available (Gemini exposes it on the response).
      try {
        const final = await stream.response;
        usage = {
          inputTokens: final.usageMetadata?.promptTokenCount,
          outputTokens: final.usageMetadata?.candidatesTokenCount,
        };
      } catch { /* usage is best-effort */ }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const msg = String(err?.message || err);
      // Friendly hints for the most common failure modes.
      if (/API_KEY/i.test(msg)) throw new ProviderError('gemini', 'API key rejected', { hint: 'Check GEMINI_API_KEY in .env' });
      if (/quota|rate/i.test(msg)) throw new ProviderError('gemini', 'Free-tier rate limit hit', { retriable: true, hint: 'Wait 60 s and retry' });
      throw new ProviderError('gemini', msg);
    }

    return {
      text: combined,
      model: modelName,
      family: 'gemini',
      usage,
      durationMs: Date.now() - t0,
    };
  },
};

export default gemini;
