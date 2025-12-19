import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wiki Graph Explorer',
  description: 'Interactive 3D visualization of Wikipedia page relationships',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}


