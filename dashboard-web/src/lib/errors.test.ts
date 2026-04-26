import { describe, it, expect } from 'vitest';
import { getErrorMessage, isApiError } from './errors';
import { ApiError } from './api';

describe('getErrorMessage', () => {
  it('handles Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('handles ApiError instances', () => {
    expect(getErrorMessage(new ApiError('forbidden', 403, null))).toBe('forbidden');
  });

  it('handles string throws', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
  });

  it('handles object with .message property', () => {
    expect(getErrorMessage({ message: 'embedded' })).toBe('embedded');
  });

  it('handles undefined and null', () => {
    expect(getErrorMessage(undefined)).toBeTruthy();
    expect(getErrorMessage(null)).toBeTruthy();
  });

  it('falls back to JSON for unknown shapes', () => {
    expect(getErrorMessage({ a: 1 })).toBe('{"a":1}');
  });
});

describe('isApiError', () => {
  it('discriminates ApiError from other Errors', () => {
    expect(isApiError(new ApiError('x', 404, null))).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isApiError('string')).toBe(false);
  });
});
