import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'See It 2 - Hero Shot Test',
  description: 'Testing the new hero shot flow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 min-h-screen">{children}</body>
    </html>
  )
}
