import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { OverflowDiagnostic } from '@/components/dev/overflow-diagnostic'
import { cache } from 'react'
import { resolveBrandData, resolveBrandForPartner, strongColor, type BrandData } from '@/lib/partner/brand'
import { BrandProvider } from '@/components/brand/brand-provider'
import { getActiveWorkspace } from '@/lib/workspace'

const inter = Inter({ subsets: ['latin'] })

// Brand precedence (cached per request so generateMetadata + RootLayout share it):
//   1. The White Label owner of the ACTIVE tenant — whether a partner is OPERATING the client, or the
//      logged-in CUSTOMER's own business is a White Label client. Resolved by white_label_partner_id,
//      NOT hostname, so branding renders on the Preview / app.scalix26.com before custom DNS. This is
//      what makes a White Label customer see the partner's software, not Scalix.
//   2. Host-matched partner brand (custom domain — future).
//   3. Default Scalix / host brand.
const resolveActiveBrand = cache(async function resolveActiveBrand(): Promise<BrandData> {
  const ws = await getActiveWorkspace()
  const wlPartner = ws.whiteLabelPartnerId || (ws.mode === 'operator' ? ws.partnerId : null)
  if (wlPartner) {
    const partnerBrand = await resolveBrandForPartner(wlPartner)
    if (partnerBrand) return partnerBrand
  }
  const host = (await headers()).get('host') || ''
  return resolveBrandData(host)
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // lock pinch-zoom so the app feels native (best-effort on iOS Safari)
}

// Brand (name, favicon) resolved operator-first (active client's partner) → host → Scalix.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await resolveActiveBrand()
  return {
    title: `${brand.name} — AI Employee Platform`,
    description: 'AI-powered customer communications for local businesses',
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await resolveActiveBrand()
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
