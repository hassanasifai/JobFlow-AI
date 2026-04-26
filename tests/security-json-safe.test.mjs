import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeParseJson, assertSafeJson, JsonSafeError } from '../lib/json-safe.mjs';

test('safeParseJson accepts plain objects and arrays', () => {
  assert.deepEqual(safeParseJson('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });
  assert.deepEqual(safeParseJson('[1,2,{"x":"y"}]'), [1, 2, { x: 'y' }]);
  assert.equal(safeParseJson('"hello"'), 'hello');
  assert.equal(safeParseJson('null'), null);
  assert.equal(safeParseJson('42'), 42);
});

test('safeParseJson rejects __proto__ at any depth', () => {
  assert.throws(
    () => safeParseJson('{"__proto__":{"polluted":true}}'),
    (err) => err instanceof JsonSafeError && /__proto__/.test(err.message),
  );
  assert.throws(
    () => safeParseJson('{"a":{"b":{"__proto__":{"x":1}}}}'),
    (err) => err instanceof JsonSafeError,
  );
  assert.throws(
    () => safeParseJson('[{"__proto__":1}]'),
    (err) => err instanceof JsonSafeError,
  );
});

test('safeParseJson rejects constructor and prototype keys', () => {
  assert.throws(() => safeParseJson('{"constructor":{}}'), JsonSafeError);
  assert.throws(() => safeParseJson('{"prototype":{}}'), JsonSafeError);
});

test('safeParseJson rejects invalid JSON with JsonSafeError', () => {
  assert.throws(() => safeParseJson('not json'), JsonSafeError);
  assert.throws(() => safeParseJson('{ unclosed'), JsonSafeError);
});

test('safeParseJson enforces maxDepth to prevent DoS', () => {
  let payload = '0';
  for (let i = 0; i < 200; i++) payload = `[${payload}]`;
  assert.throws(() => safeParseJson(payload, { maxDepth: 32 }), JsonSafeError);
});

test('assertSafeJson validates already-parsed values', () => {
  assert.equal(assertSafeJson({ a: 1 }).a, 1);
  // Object-literal `{ __proto__: x }` invokes the prototype setter; to get an
  // own-property called __proto__ we have to go through JSON.parse, which is
  // exactly the attacker's vector this guard exists to catch.
  const polluted = JSON.parse('{"__proto__":{"x":1}}');
  assert.throws(() => assertSafeJson(polluted), JsonSafeError);
});

test('safeParseJson does not pollute Object.prototype', () => {
  // Pre-test sanity: prototype is clean.
  assert.equal({}.polluted, undefined);
  try {
    safeParseJson('{"__proto__":{"polluted":"yes"}}');
  } catch { /* expected */ }
  // After: still clean.
  assert.equal({}.polluted, undefined);
});
