// lib/json-safe.mjs
// JSON parsing with prototype-pollution guards. Use everywhere we parse JSON
// that originated from outside our trust boundary (HTTP request bodies,
// upstream API responses, on-disk caches that could be tampered with).
//
// Rationale: a payload like {"__proto__": {"isAdmin": true}} mutated through
// a naive merge can corrupt Object.prototype. Rejecting these keys at parse
// time is cheap, complete, and obvious.

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Parse JSON and walk the result, throwing on prototype-pollution keys.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=64] Hard cap on nesting depth (DoS guard).
 * @returns {*} Parsed value.
 */
export function safeParseJson(text, opts = {}) {
  const { maxDepth = 64 } = opts;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new JsonSafeError(`Invalid JSON: ${err.message}`);
  }
  walk(parsed, maxDepth, 0);
  return parsed;
}

/**
 * Validate an already-parsed value (e.g. after `await res.json()`).
 * Returns the value on success, throws on violation.
 */
export function assertSafeJson(value, opts = {}) {
  const { maxDepth = 64 } = opts;
  walk(value, maxDepth, 0);
  return value;
}

function walk(node, maxDepth, depth) {
  if (depth > maxDepth) {
    throw new JsonSafeError(`JSON exceeds max depth (${maxDepth})`);
  }
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, maxDepth, depth + 1);
    return;
  }

  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new JsonSafeError(`Forbidden key in JSON payload: ${key}`);
    }
    walk(node[key], maxDepth, depth + 1);
  }
}

export class JsonSafeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JsonSafeError';
  }
}
