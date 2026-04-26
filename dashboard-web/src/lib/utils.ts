// src/lib/utils.ts
// shadcn convention: `cn` merges Tailwind classes with conflict resolution
// (later classes win). Imported by every shadcn UI component.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
