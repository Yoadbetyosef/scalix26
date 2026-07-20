import { createAdminClient } from '@/lib/supabase/server'

// Tenant proposal branding. Merges the proposal_branding row over the tenants row so there is always a
// complete, sensible set of values to render (logo/name/contact/accent/copy) with no duplicate storage.
const admin = () => createAdminClient()

export interface Branding {
  logo_url: string | null
  business_name: string
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  accent_color: string
  header_style: string
  footer_text: string | null
  intro: string | null
  default_terms: string | null
  default_email_subject: string | null
  default_email_message: string | null
}

export async function getBranding(tenantId: string): Promise<Branding> {
  const [{ data: b }, { data: t }] = await Promise.all([
    admin().from('proposal_branding').select('*').eq('tenant_id', tenantId).maybeSingle(),
    admin().from('tenants').select('business_name, address, phone, email, website').eq('id', tenantId).maybeSingle(),
  ])
  const pick = (k: keyof Branding) => (b?.[k] as string) ?? null
  return {
    logo_url: pick('logo_url'),
    business_name: (b?.business_name as string) || (t?.business_name as string) || 'Your Business',
    address: pick('address') ?? (t?.address as string) ?? null,
    phone: pick('phone') ?? (t?.phone as string) ?? null,
    email: pick('email') ?? (t?.email as string) ?? null,
    website: pick('website') ?? (t?.website as string) ?? null,
    accent_color: (b?.accent_color as string) || '#5b6cf0',
    header_style: (b?.header_style as string) || 'standard',
    footer_text: pick('footer_text'),
    intro: pick('intro'),
    default_terms: pick('default_terms'),
    default_email_subject: pick('default_email_subject'),
    default_email_message: pick('default_email_message'),
  }
}

export interface BrandingPatch { logo_url?: string | null; business_name?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; accent_color?: string; header_style?: string; footer_text?: string | null; intro?: string | null; default_terms?: string | null; default_email_subject?: string | null; default_email_message?: string | null }

export async function setBranding(tenantId: string, patch: BrandingPatch): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v
  const { error } = await admin().from('proposal_branding').upsert(row, { onConflict: 'tenant_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
