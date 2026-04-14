import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CoinBuddy',
  description:
    'CoinBuddy is an AI-native DeFi pet agent for yield discovery, execution, and simple strategy automation.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
