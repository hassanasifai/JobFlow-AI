import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { PageTransition } from '@/components/ui/page-transition';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'JobFlow AI · Dashboard',
  description: 'AI-driven job-search command center — discover, evaluate, and apply.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full bg-background text-foreground">
        <Providers>
          <div className="relative flex min-h-screen">
            <Sidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <Topbar />
              <main className="relative flex-1 px-4 md:px-8 py-6">
                <PageTransition>{children}</PageTransition>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
