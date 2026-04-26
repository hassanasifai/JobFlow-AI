import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Vitest runs the dialogs in a happy-dom environment. We don't use jsdom
// because happy-dom is faster and supports the modern DOM APIs we need.
//
// React 19 + Next 16 means we have to use @vitejs/plugin-react with the
// new automatic JSX transform. The jsx-runtime config lives in the plugin.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,                       // describe/it/expect without import
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,                            // let test components import CSS modules
  },
  resolve: {
    alias: {
      '@': path.resolve(here, './src'),
    },
  },
});
