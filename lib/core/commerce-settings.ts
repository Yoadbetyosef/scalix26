import { createAdminClient } from '@/lib/supabase/server'
import { getStatus as qbStatus } from '@/lib/quickbooks/connection'
import { getConnectStatus } from '@/lib/stripe/connect'

// Tenant commerce settings (default invoice provider + invoice defaults) and provider availability. Provider
// config lives here, NOT on the proposal. Connected status is READ from the existing QuickBooks/Stripe
// integrations — we never build a second connection system.
const admin = () => createAdminClient()

export interface CommerceSettings { default_invoice_provider: string; invoice_send_by_default: boolean; default_payment_terms_days: number; default_tax_behavior: string; default_invoice_email_message: string | null }
const DEFAULTS: CommerceSettings = { default_invoice_provider: 'scalix', invoice_send_by_default: false, default_payment_terms_days: 14, default_tax_behavior: 'none', default_invoice_email_message: null }

export async function getCommerceSettings(tenantId: string): Promise<CommerceSettings> {
  const { data } = await admin().from('commerce_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  if (!data) return { ...DEFAULTS }
  return {
    default_invoice_provider: (data.default_invoice_provider as string) || 'scalix',
    invoice_send_by_default: !!data.invoice_send_by_default,
    default_payment_terms_days: (data.default_payment_terms_days as number) ?? 14,
    default_tax_behavior: (data.default_tax_behavior as string) || 'none',
    default_invoice_email_message: (data.default_invoice_email_message as string) ?? null,
  }
}

export async function setCommerceSettings(tenantId: string, patch: Partial<CommerceSettings>): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v
  const { error } = await admin().from('commerce_settings').upsert(row, { onConflict: 'tenant_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export type ProviderKind = 'invoice' | 'payment_link'
export interface InvoiceProvider { id: 'scalix' | 'quickbooks' | 'stripe'; name: string; kind: ProviderKind; connected: boolean; isDefault: boolean; note?: string; detail?: string }

// The providers actually available to this tenant right now. Only connected/enabled ones are shown as usable.
export async function listInvoiceProviders(tenantId: string): Promise<{ providers: InvoiceProvider[]; default: string }> {
  const settings = await getCommerceSettings(tenantId)
  const [qb, stripe] = await Promise.all([qbStatus(tenantId).catch(() => ({ connected: false } as { connected: boolean; companyName?: string | null })), getConnectStatus(tenantId).catch(() => null)])
  const stripeConnected = !!(stripe && (stripe as { charges_enabled?: boolean }).charges_enabled)
  const def = settings.default_invoice_provider
  const providers: InvoiceProvider[] = [
    { id: 'scalix', name: 'Scalix Invoice', kind: 'invoice', connected: true, isDefault: def === 'scalix', detail: 'Create an internal invoice in Scalix.' },
    { id: 'quickbooks', name: 'QuickBooks', kind: 'invoice', connected: qb.connected, isDefault: def === 'quickbooks', detail: qb.connected ? `Sync to QuickBooks${(qb as { companyName?: string | null }).companyName ? ` (${(qb as { companyName?: string | null }).companyName})` : ''}.` : 'Connect QuickBooks in Settings to enable.' },
    { id: 'stripe', name: 'Stripe payment link', kind: 'payment_link', connected: stripeConnected, isDefault: false, note: 'Creates a Stripe payment link (Checkout) — NOT a full Stripe invoice.', detail: stripeConnected ? 'Attach a Stripe payment link to the invoice.' : 'Connect Stripe (Payments) to enable.' },
  ]
  return { providers, default: providers.find((p) => p.id === def && p.connected) ? def : 'scalix' }
}
