import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { OverflowDiagnostic } from '@/components/dev/overflow-diagnostic'
import { resolveBrandData, strongColor } from '@/lib/partner/brand'
import { BrandProvider } from '@/components/brand/brand-provider'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // lock pinch-zoom so the app feels native (best-effort on iOS Safari)
}

// Brand (name, favicon) resolved by host — Scalix by default, the partner's brand on their domain.
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host') || ''
  const brand = await resolveBrandData(host)
  return {
    title: `${brand.name} — AI Employee Platform`,
    description: 'AI-powered customer communications for local businesses',
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = (await headers()).get('host') || ''
  const brand = await resolveBrandData(host)
  // Inject the partner's accent as CSS variables → rebrands the entire app in one place.
  const style = brand.primaryColor
    ? ({ '--color-accent': brand.primaryColor, '--color-accent-strong': strongColor(brand.primaryColor) || brand.primaryColor } as React.CSSProperties)
    : undefined

  return (
    <html lang="en" className="h-full" style={style}>
      <body className={`${inter.className} h-full antialiased`}>
        <BrandProvider brand={brand}>
          {children}
        </BrandProvider>
        <Toaster />
        <OverflowDiagnostic />
      </body>
    </html>
  )
}
