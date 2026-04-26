'use client';

import { useEffect, useState } from 'react';

/** Debounce a value by `delay` ms — kicks the heavy /api/jobs filter off the
 *  keystroke path so the search box stays responsive. */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
