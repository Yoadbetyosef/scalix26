import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { resolveBrand } from '@/lib/brands'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

// Host-based title so the browser tab shows the right brand everywhere
// (myLocksmith Ai on its domain, Scalix26 on scalix26.com / by default).
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host') || ''
  const brand = resolveBrand(host)
  return {
    title: `${brand.name} — AI Employee Platform`,
    description: 'AI-powered customer communications for home services businesses',
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
