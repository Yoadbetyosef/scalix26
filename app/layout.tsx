import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { cache } from 'react'
import { resolveBrandData, resolveBrandForPartner, strongColor, type BrandData } from '@/lib/partner/brand'
import { BrandProvider } from '@/components/brand/brand-provider'
import { getActiveWorkspace } from '@/lib/workspace'
import { NEUTRAL_BRAND, PATHNAME_HEADER, isCustomerDocumentPath } from '@/lib/documents/routes'

const inter = Inter({ subsets: ['latin'] })

// Brand precedence (cached per request so generateMetadata + RootLayout share it):
//   1. The White Label owner of the ACTIVE tenant — whether a partner is OPERATING the client, or the
//      logged-in CUSTOMER's own business is a White Label client. Resolved by white_label_partner_id,
//      NOT hostname, so branding renders on the Preview / app.scalix26.com before custom DNS. This is
//      what makes a White Label customer see the partner's software, not Scalix.
//   2. Host-matched partner brand (custom domain — future).
//   3. Default Scalix / host brand.
//
//   0. NOTHING, on a customer-facing document. This case comes FIRST and is the fix for a leak that
//      reached every white-label tenant: an estimate, quote, invoice or approval page has no session,
//      so rules 1 and 2 could not apply and it fell through to rule 3 — the HOST — which on
//      app.scalix26.com is us. Every one of those documents therefore carried our name in its title,
//      and Chrome prints the title at the top of every page. The host cannot know whose customer is
//      reading a document; only the document's own row can, and the route resolves it from there.
const resolveActiveBrand = cache(async function resolveActiveBrand(): Promise<BrandData> {
  const pathname = (await headers()).get(PATHNAME_HEADER) || ''
  if (isCustomerDocumentPath(pathname)) return { ...NEUTRAL_BRAND }

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
  // A neutral brand means a customer document, and the route below supplies its own title from the
  // tenant. Returning nothing here rather than a platform title means that even if a document route
  // ever forgets to override, the worst case is an empty title — not somebody else's brand.
  if (!brand.name) return { title: '', robots: { index: false, follow: false } }
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
      </body>
    </html>
  )
}
