// Pure-function tests for format helpers. Validates that the vitest +
// path-alias setup is wired correctly, plus pins behavior of helpers that
// every page uses (relativeTime, statusColor, statusLabel, regionLabel).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  relativeTime, statusColor, statusLabel, regionLabel,
} from './format';

describe('relativeTime', () => {
  // Pin "now" so the relative phrasing is deterministic.
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-26T12:00:00Z')); });
  afterAll(() => { vi.useRealTimers(); });

  it('returns em-dash for null / invalid', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime(undefined)).toBe('—');
    expect(relativeTime('not a date')).toBe('—');
  });

  it('formats minute / hour / day spans', () => {
    expect(relativeTime('2026-04-26T11:55:00Z')).toBe('5 minutes ago');
    expect(relativeTime('2026-04-26T10:00:00Z')).toBe('2 hours ago');
    expect(relativeTime('2026-04-25T12:00:00Z')).toBe('1 day ago');
    expect(relativeTime('2026-04-19T12:00:00Z')).toBe('1 week ago');
  });

  it('says "just now" for sub-minute spans', () => {
    expect(relativeTime('2026-04-26T11:59:30Z')).toBe('just now');
  });
});

describe('statusColor / statusLabel', () => {
  it('covers every status the API can return', () => {
    const all = ['healthy', 'stale', 'error', 'unavailable', 'needs_config',
                 'needs_inputs', 'needs_ack', 'unknown'];
    for (const s of all) {
      expect(statusColor(s)).toMatch(/^bg-/);
      expect(statusLabel(s)).toBeTypeOf('string');
      expect(statusLabel(s).length).toBeGreaterThan(0);
    }
  });

  it('includes the new needs_ack status added for linkedin-guest', () => {
    expect(statusLabel('needs_ack')).toMatch(/ToS|acknowledg/i);
    expect(statusColor('needs_ack')).toMatch(/orange/);
  });

  it('falls back gracefully for unrecognized status', () => {
    expect(statusColor('xyz')).toBe('bg-zinc-300');
    expect(statusLabel('xyz')).toBe('No data');
  });
});

describe('regionLabel', () => {
  it('maps known region groups to display labels', () => {
    expect(regionLabel('pakistan')).toBe('Pakistan');
    expect(regionLabel('gcc')).toBe('Gulf / GCC');
    expect(regionLabel('remote_worldwide')).toBe('Remote · worldwide');
  });

  it('falls back to the raw value for unknown groups', () => {
    expect(regionLabel('latam')).toBe('latam');
    expect(regionLabel(null)).toBe('Unknown');
  });
});
