import { createAdminClient } from '@/lib/supabase/server'
import { resolveBrand } from '@/lib/brands'

// Serializable brand data, resolved by request host. A White Label partner's brand (from a custom
// domain) overrides the static host brand — otherwise we fall back to the existing Scalix/host brand.
// Cached briefly so the layout doesn't hit the DB on every navigation.

export interface BrandData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  supportEmail: string | null
  supportPhone: string | null
  website: string | null
  emailFooter: string | null
  loginBackgroundUrl: string | null
  poweredByScalix: boolean
  isPartnerBrand: boolean
}

const cache = new Map<string, { at: number; brand: BrandData }>()
const TTL = 60_000

const normHost = (host?: string | null) => (host || '').split(':')[0].trim().toLowerCase()

// Darken a #rrggbb color ~18% for the "strong" accent (hover/text on light).
export function strongColor(hex: string | null): string | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  const d = (c: number) => Math.max(0, Math.round(c * 0.72))
  const r = d((n >> 16) & 255), g = d((n >> 8) & 255), b = d(n & 255)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function fallback(host?: string | null): BrandData {
  const b = resolveBrand(normHost(host))
  return {
    name: b.name, logoUrl: null, faviconUrl: null, primaryColor: null, secondaryColor: null,
    supportEmail: null, supportPhone: null, website: null, emailFooter: null, loginBackgroundUrl: null,
    poweredByScalix: true, isPartnerBrand: false,
  }
}

export async function resolveBrandData(host?: string | null): Promise<BrandData> {
  const h = normHost(host)
  if (!h) return fallback(host)
  const hit = cache.get(h)
  if (hit && Date.now() - hit.at < TTL) return hit.brand

  const { data } = await createAdminClient().from('partner_brands').select('*').eq('custom_domain', h).maybeSingle()
  let brand: BrandData
  if (data) {
    brand = {
      name: data.company_name || fallback(host).name,
      logoUrl: data.logo_url || null, faviconUrl: data.favicon_url || null,
      primaryColor: data.primary_color || null, secondaryColor: data.secondary_color || null,
      supportEmail: data.support_email || null, supportPhone: data.support_phone || null, website: data.website || null,
      emailFooter: data.email_footer || null, loginBackgroundUrl: data.login_background_url || null,
      poweredByScalix: data.powered_by_scalix ?? true, isPartnerBrand: true,
    }
  } else {
    brand = fallback(host)
  }
  cache.set(h, { at: Date.now(), brand })
  return brand
}

// Resolve a partner's brand by partner id (operator mode: the active client tenant's owning White
// Label partner). Independent of hostname, so partner branding renders on the Preview / app.scalix26.com
// before custom DNS is connected. Returns null when the partner hasn't configured a brand yet.
export async function resolveBrandForPartner(partnerId: string): Promise<BrandData | null> {
  const key = `partner:${partnerId}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.brand

  const { data } = await createAdminClient().from('partner_brands').select('*').eq('partner_id', partnerId).maybeSingle()
  if (!data) return null
  const brand: BrandData = {
    name: data.company_name || 'Scalix',
    logoUrl: data.logo_url || null, faviconUrl: data.favicon_url || null,
    primaryColor: data.primary_color || null, secondaryColor: data.secondary_color || null,
    supportEmail: data.support_email || null, supportPhone: data.support_phone || null, website: data.website || null,
    emailFooter: data.email_footer || null, loginBackgroundUrl: data.login_background_url || null,
    poweredByScalix: data.powered_by_scalix ?? true, isPartnerBrand: true,
  }
  cache.set(key, { at: Date.now(), brand })
  return brand
}

export function clearBrandCache() { cache.clear() }
