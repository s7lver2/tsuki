import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'tsuki',
  description: 'Write in Go · Upload in C++ · Made for Arduino',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Geist font from Vercel CDN */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;1,400&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('gdi-theme') || 'dark';
                document.documentElement.className = theme;
              } catch(e) {}
            `
          }}
        />
      </head>
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  )
}