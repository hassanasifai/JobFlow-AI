// @vitest-environment jsdom
//
// sanitizeHtml is the gate between provider-supplied HTML and the DOM.
// These tests document what the policy strips vs preserves.
// Forced to jsdom because happy-dom's HTML parser is not spec-complete enough
// for DOMPurify's tag/attribute policies to behave as documented — jsdom is
// the canonical reference DOM that DOMPurify is tested against.

import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize-html';

describe('sanitizeHtml', () => {
  it('preserves the safe tags real job feeds emit', () => {
    const html = '<p>Hello <strong>world</strong></p><ul><li>One</li><li>Two</li></ul>';
    const out = sanitizeHtml(html);
    expect(out).toContain('<p>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>One</li>');
  });

  it('strips <script> entirely (the core XSS vector)', () => {
    const out = sanitizeHtml('<p>before</p><script>alert(1)</script><p>after</p>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips event handlers like onerror, onclick, onload', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><p onclick="bad()">click</p>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/alert/i);
  });

  it('strips iframes, object, embed (frame-injection vectors)', () => {
    const out = sanitizeHtml('<iframe src="https://evil.com"></iframe><object data="x"></object>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
  });

  it('strips javascript: URLs in href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('preserves http(s) links', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">link</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it('handles null/undefined/empty input', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });

  it('preserves text content when an unknown tag is stripped', () => {
    const out = sanitizeHtml('<custom-tag>retain</custom-tag>');
    expect(out).toContain('retain');
  });
});
