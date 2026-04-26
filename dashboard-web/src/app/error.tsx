'use client';

// Route-level error boundary. Catches errors thrown in any page or nested
// segment under the app root. Per Next 16, error.tsx wraps page.tsx +
// loading.tsx + not-found.tsx, but NOT the root layout — for layout-level
// failures we have global-error.tsx as the last line of defense.

import { useEffect } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to dev tools and any future error reporter. Avoid logging
    // PII (the message can be user-provided strings).
    if (process.env.NODE_ENV !== 'production') {
      console.error('[RouteError]', error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="max-w-lg w-full border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This page hit an unexpected error. The rest of the app is still
            usable — try the action again or navigate to another page.
          </p>
          {error.digest && (
            <p className="text-xs font-mono text-muted-foreground">
              Reference: <span className="select-all">{error.digest}</span>
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset} className="gap-1.5">
              <RefreshCcw className="h-4 w-4" />
              Try again
            </Button>
            <Button asChild variant="outline">
              <a href="/dashboard/">Go home</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
