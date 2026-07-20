import { createAdminClient } from '@/lib/supabase/server'

// Terminology overrides — a tenant may relabel SUPPORTED business nouns only (a jewelry shop calls an
// "order" a "memo"). System actions (Save/Delete/Settings) are NOT supported nouns and can never be
// renamed. The supported set is the whitelist; anything else is rejected.
export const SUPPORTED_TERMS = {
  contact: { singular: 'Contact', plural: 'Contacts' },
  company: { singular: 'Company', plural: 'Companies' },
  lead: { singular: 'Lead', plural: 'Leads' },
  appointment: { singular: 'Appointment', plural: 'Appointments' },
  estimate: { singular: 'Estimate', plural: 'Estimates' },
  quote: { singular: 'Quote', plural: 'Quotes' },
  order: { singular: 'Order', plural: 'Orders' },
  invoice: { singular: 'Invoice', plural: 'Invoices' },
  payment: { singular: 'Payment', plural: 'Payments' },
  product: { singular: 'Product', plural: 'Products' },
  variant: { singular: 'Variant', plural: 'Variants' },
  component: { singular: 'Component', plural: 'Components' },
  catalog: { singular: 'Catalog', plural: 'Catalog' },       // surface label (furniture → "Inventory")
  material: { singular: 'Material', plural: 'Materials' },    // material/finish library (furniture → "Fabric(s)")
} as const
export type SupportedTerm = keyof typeof SUPPORTED_TERMS
export function isSupportedTerm(k: string): k is SupportedTerm { return Object.prototype.hasOwnProperty.call(SUPPORTED_TERMS, k) }

export interface TermOverride { singular?: string | null; plural?: string | null }
// Pure resolver — override wins, else Core default, else the raw key. Unit-tested.
export function resolveTerm(nounKey: string, overrides: Record<string, TermOverride>, opts: { plural?: boolean } = {}): string {
  const def = (SUPPORTED_TERMS as Record<string, { singular: string; plural: string }>)[nounKey]
  const o = overrides[nounKey]
  const pick = (a?: string | null, b?: string) => (a && a.trim() ? a : b) ?? nounKey
  return opts.plural ? pick(o?.plural, def?.plural) : pick(o?.singular, def?.singular)
}

const admin = () => createAdminClient()

// Set/clear an override — REJECTS any non-supported noun (so system actions can't be renamed).
export async function setTermOverride(tenantId: string, nounKey: string, value: TermOverride): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupportedTerm(nounKey)) return { ok: false, error: 'unsupported_term' }
  const { error } = await admin().from('terminology_overrides').upsert(
    { tenant_id: tenantId, noun_key: nounKey, singular: value.singular ?? null, plural: value.plural ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,noun_key' },
  )
  return error ? { ok: false, error: error.message } : { ok: true }
}

// The tenant's full terminology map (Core defaults merged with overrides).
export async function getTerminology(tenantId: string): Promise<Record<string, { singular: string; plural: string }>> {
  const { data } = await admin().from('terminology_overrides').select('noun_key, singular, plural').eq('tenant_id', tenantId)
  const overrides: Record<string, TermOverride> = {}
  for (const r of (data ?? []) as Array<{ noun_key: string; singular: string | null; plural: string | null }>) overrides[r.noun_key] = { singular: r.singular, plural: r.plural }
  const out: Record<string, { singular: string; plural: string }> = {}
  for (const key of Object.keys(SUPPORTED_TERMS)) out[key] = { singular: resolveTerm(key, overrides), plural: resolveTerm(key, overrides, { plural: true }) }
  return out
}
