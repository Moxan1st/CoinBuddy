import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CoinBuddy',
  description:
    'CoinBuddy is an AI-native DeFi pet agent for yield discovery, execution, and simple strategy automation.',
  icons: {
    icon: '/icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
