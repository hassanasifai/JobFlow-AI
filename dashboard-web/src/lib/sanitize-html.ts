// src/lib/sanitize-html.ts
// Centralized HTML sanitizer for any place we feed provider-supplied
// markup into dangerouslySetInnerHTML. The audit flagged the JD drawer as
// the only current consumer, but routing every call through this helper
// means future consumers inherit the policy automatically.

import DOMPurify from 'isomorphic-dompurify';

// Minimal tag/attribute whitelist scoped to what real job feeds emit:
// Greenhouse/Ashby/Lever produce <p>, <ul>, <li>, <strong>, <em>, <br>, <a>.
// JSON-LD JobPosting can include <h2>-<h4>. Anything else is stripped.
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li',
  'a', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'class'];

/**
 * Sanitize HTML for safe insertion via dangerouslySetInnerHTML.
 *
 * Defaults: strip all scripts, event handlers, iframes, and unknown tags.
 * Force `target="_blank"` links to also have `rel="noopener noreferrer"`.
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(String(input), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // ADD_ATTR is layered on top of ALLOWED_ATTR.
    // KEEP_CONTENT keeps text nodes when their tag is stripped.
    KEEP_CONTENT: true,
    // Belt-and-braces: explicitly forbid javascript: URLs in href.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
  });
}
