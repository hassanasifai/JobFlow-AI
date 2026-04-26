// Adds Testing Library's `toBeInTheDocument`, `toHaveTextContent`, etc.
// matchers to vitest's expect global. Without this they're typed but at
// runtime the assertion functions don't exist.
import '@testing-library/jest-dom/vitest';

// happy-dom doesn't ship `Element.prototype.scrollIntoView` (and Radix-UI's
// Select uses it on open), so we polyfill it as a no-op for tests that
// render Select components.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// happy-dom doesn't support ResizeObserver out of the box. Radix-UI uses
// it for popper positioning. Stub it so the dialogs render.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Basic matchMedia stub so theme components don't crash on mount.
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
