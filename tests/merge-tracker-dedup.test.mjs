import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFuzzyMatch, normalizeCompany, escapeFormula } from '../merge-tracker.mjs';

test('roleFuzzyMatch identifies obvious duplicates', () => {
  assert.equal(roleFuzzyMatch('Backend Engineer', 'Backend Engineer'), true);
  assert.equal(roleFuzzyMatch('Software Engineer', 'Software Engineer (Remote)'), true);
});

test('roleFuzzyMatch distinguishes seniority levels', () => {
  // Bug from auditor: "Senior X" vs "X" was being folded together.
  assert.equal(roleFuzzyMatch('Senior Machine Learning Engineer', 'Machine Learning Engineer'), false);
  assert.equal(roleFuzzyMatch('Senior Backend Engineer', 'Backend Engineer'), false);
  assert.equal(roleFuzzyMatch('Lead Data Scientist', 'Data Scientist'), false);
  assert.equal(roleFuzzyMatch('Principal Software Engineer', 'Staff Software Engineer'), false);
  assert.equal(roleFuzzyMatch('Junior Developer', 'Senior Developer'), false);
});

test('roleFuzzyMatch distinguishes different roles', () => {
  assert.equal(roleFuzzyMatch('Backend Engineer', 'Frontend Engineer'), false);
  assert.equal(roleFuzzyMatch('Data Engineer', 'Software Engineer'), false);
  assert.equal(roleFuzzyMatch('Product Manager', 'Engineering Manager'), false);
});

test('roleFuzzyMatch matches across light formatting differences', () => {
  assert.equal(roleFuzzyMatch('Senior Backend Engineer', 'Senior Backend Engineer (Hybrid)'), true);
  assert.equal(roleFuzzyMatch('Data Scientist, NLP', 'Data Scientist - NLP'), true);
});

test('roleFuzzyMatch returns false on empty input', () => {
  assert.equal(roleFuzzyMatch('', 'Engineer'), false);
  assert.equal(roleFuzzyMatch('Engineer', ''), false);
  assert.equal(roleFuzzyMatch(null, null), false);
});

test('normalizeCompany strips punctuation and case', () => {
  assert.equal(normalizeCompany('Acme, Inc.'), 'acmeinc');
  assert.equal(normalizeCompany('ACME-Corp'), 'acmecorp');
  assert.equal(normalizeCompany('Foo & Bar'), 'foobar');
});

test('escapeFormula prefixes spreadsheet metacharacters', () => {
  assert.equal(escapeFormula('=cmd|"calc"'), "'=cmd|\"calc\"");
  assert.equal(escapeFormula('+1234'), "'+1234");
  assert.equal(escapeFormula('-cmd'), "'-cmd");
  assert.equal(escapeFormula('@SUM(1+2)'), "'@SUM(1+2)");
});

test('escapeFormula leaves safe values untouched', () => {
  assert.equal(escapeFormula('Acme Corp'), 'Acme Corp');
  assert.equal(escapeFormula('Senior Engineer'), 'Senior Engineer');
  assert.equal(escapeFormula(''), '');
  assert.equal(escapeFormula(null), '');
  assert.equal(escapeFormula(undefined), '');
});
