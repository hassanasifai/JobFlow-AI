// scanners/agents/registry.mjs
//
// Static registry of providers. `discoverProviders()` resolves availability
// in parallel so the GET /api/agents endpoint returns in one round-trip.

import gemini from './gemini.mjs';
import openai from './openai.mjs';
import claudeCode from './claude-code.mjs';

const PROVIDERS = [claudeCode, gemini, openai];

/** Return all known providers with availability resolved. */
export async function discoverProviders() {
  const out = await Promise.all(PROVIDERS.map(async (p) => {
    let avail;
    try { avail = await p.available(); }
    catch (err) {
      avail = { available: false, reason: String(err?.message || err) };
    }
    return {
      id: p.id,
      label: p.label,
      family: p.family,
      defaultModel: p.defaultModel,
      costsMoney: !!p.costsMoney,
      ...avail,
    };
  }));
  return out;
}

/**
 * Look up a provider by id. Throws when the id is unknown so callers don't
 * accidentally fall back to a random provider.
 */
export function getProvider(id) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}. Known: ${PROVIDERS.map((x) => x.id).join(', ')}`);
  return p;
}

/** Default provider — the first available one in priority order. */
export async function defaultProvider() {
  const list = await discoverProviders();
  const ok = list.find((x) => x.available);
  if (!ok) throw new Error('No agent provider is available. Set GEMINI_API_KEY, OPENAI_API_KEY, or install Claude Code.');
  return getProvider(ok.id);
}

export const knownProviderIds = PROVIDERS.map((p) => p.id);
