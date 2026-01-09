import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertBanner } from '@/components/alerts/AlertBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'See It Monitor',
  description: 'Session monitoring dashboard for See It app',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <AlertBanner />
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center gap-8">
                <Link href="/" className="font-semibold text-lg text-primary">
                  See It Monitor
                </Link>
                <div className="flex gap-6">
                  <Link
                    href="/"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Control Room
                  </Link>
                  <Link
                    href="/sessions"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Sessions
                  </Link>
                  <Link
                    href="/merchants"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Merchants
                  </Link>
                  <Link
                    href="/journey"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Journey
                  </Link>
                  <Link
                    href="/costs"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Costs
                  </Link>
                  <Link
                    href="/errors"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Errors
                  </Link>
                  <Link
                    href="/monitor/prep"
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    Prep Monitor
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
