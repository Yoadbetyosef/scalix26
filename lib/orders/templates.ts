import { createAdminClient } from '@/lib/supabase/server'
import type { DocBranding, DocBusiness } from './documents'

// Document templates — one business trading under more than one name.
//
// TG Jewellers (retail) and TG Designs (B2B) put different logos, addresses and terms on their
// paperwork. Built as a general capability: any tenant may define any number, and a tenant with none
// behaves exactly as it did before this existed.
//
// ── EVERY READ HERE SURVIVES THE MIGRATION NOT HAVING RUN ───────────────────────────────────────────
//
// PostgREST errors on a missing table rather than returning empty, so a plain select would break the
// document page for every tenant until the SQL is applied. Each read is wrapped and falls back to the
// tenant's own details — which is exactly today's behaviour — so code and schema can deploy in either
// order.

export interface DocumentTemplate {
  id: string
  name: string
  companyName: string | null
  logoUrl: string | null
  accentColor: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  terms: string | null
  validityDays: number | null
  footerNote: string | null
  isDefault: boolean
}

const row = (r: Record<string, unknown>): DocumentTemplate => ({
  id: r.id as string,
  name: (r.name as string) ?? 'Template',
  companyName: (r.company_name as string) ?? null,
  logoUrl: (r.logo_url as string) ?? null,
  accentColor: (r.accent_color as string) ?? null,
  email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null,
  website: (r.website as string) ?? null,
  address: (r.address as string) ?? null,
  city: (r.city as string) ?? null,
  state: (r.state as string) ?? null,
  zip: (r.zip as string) ?? null,
  terms: (r.terms as string) ?? null,
  validityDays: r.validity_days === null || r.validity_days === undefined ? null : Number(r.validity_days),
  footerNote: (r.footer_note as string) ?? null,
  isDefault: r.is_default === true,
})

/** Every template a tenant has defined. Empty — not an error — when the table does not exist yet. */
export async function listTemplates(tenantId: string): Promise<DocumentTemplate[]> {
  try {
    const { data, error } = await createAdminClient()
      .from('document_templates').select('*').eq('tenant_id', tenantId).order('is_default', { ascending: false }).order('name')
    if (error) return []
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
  } catch {
    return []
  }
}

export async function getTemplate(tenantId: string, id: string | null | undefined): Promise<DocumentTemplate | null> {
  if (!id) return null
  try {
    const { data, error } = await createAdminClient()
      .from('document_templates').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    if (error || !data) return null
    return row(data as Record<string, unknown>)
  } catch {
    return null
  }
}

/**
 * The template a document should use: the order's own, else the tenant's default, else none.
 *
 * "Else none" is deliberate. A tenant with no templates gets the behaviour it has today rather than an
 * empty header, and a tenant that deleted the template an old order pointed at falls back rather than
 * rendering a blank company.
 */
export async function templateForOrder(tenantId: string, templateId: string | null | undefined): Promise<DocumentTemplate | null> {
  const explicit = await getTemplate(tenantId, templateId)
  if (explicit) return explicit
  const all = await listTemplates(tenantId)
  return all.find((t) => t.isDefault) ?? null
}

/**
 * Fold a template over the tenant's own details.
 *
 * A template is a complete OVERRIDE where it has a value, and transparent where it does not — so a
 * template that only sets a logo and a name still inherits the tenant's phone number rather than
 * printing a blank. The alternative, a strict all-or-nothing override, forces a business to re-enter
 * details it has already given us.
 */
export function applyTemplate(
  t: DocumentTemplate | null,
  branding: DocBranding,
  business: DocBusiness,
): { branding: DocBranding; business: DocBusiness; footerNote: string | null; templateName: string | null } {
  if (!t) return { branding, business, footerNote: null, templateName: null }
  return {
    branding: {
      logoUrl: t.logoUrl ?? branding.logoUrl,
      accent: t.accentColor ?? branding.accent,
      terms: t.terms ?? branding.terms,
      validityDays: t.validityDays ?? branding.validityDays,
    },
    business: {
      businessName: t.companyName ?? business.businessName,
      email: t.email ?? business.email,
      phone: t.phone ?? business.phone,
      website: t.website ?? business.website,
      address: t.address ?? business.address,
      city: t.city ?? business.city,
      state: t.state ?? business.state,
      zip: t.zip ?? business.zip,
    },
    footerNote: t.footerNote,
    templateName: t.name,
  }
}
