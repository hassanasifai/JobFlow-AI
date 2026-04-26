'use client';

// Root-level error boundary. Catches errors thrown inside the root layout
// itself — error.tsx can't see those. Per Next 16, global-error.tsx must
// render its own <html> + <body>, since the root layout failed to mount.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[GlobalError]', error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: '#0a0a0a',
          color: '#f4f4f5',
        }}
      >
        <main style={{ maxWidth: 480, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>
            JobFlow AI hit a fatal error
          </h1>
          <p style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 20 }}>
            The dashboard could not render. Reload the page or check the
            console for details.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 12,
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                color: '#71717a',
                marginBottom: 20,
              }}
            >
              Reference: <span style={{ userSelect: 'all' }}>{error.digest}</span>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              border: '1px solid #3f3f46',
              borderRadius: 8,
              padding: '8px 16px',
              background: '#18181b',
              color: '#f4f4f5',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
