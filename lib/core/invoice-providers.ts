import { createAdminClient } from '@/lib/supabase/server'
import { convertProposalToInvoice } from './proposals'
import { logActivity } from './proposal-activity'
import { getBranding } from './proposal-branding'
import { createQuickBooksInvoice } from '@/lib/quickbooks/invoicing'
import { getConnectedAccountId } from '@/lib/stripe/connect'
import { createConnectCheckout } from '@/lib/stripe/payment-collection'

// Provider-aware invoice creation. The Core invoice is ALWAYS created first (internal record + idempotency);
// then, for QuickBooks we push a real QB invoice, and for Stripe we attach a Checkout payment link (NOT a
// Stripe invoice). Provider failure never destroys the internal record — it lands as sync_status='failed'
// and is retryable. Reuses the existing QuickBooks OAuth + Stripe Connect — no second connection system.
const admin = () => createAdminClient()
const now = () => new Date().toISOString()

export type InvoiceProviderId = 'scalix' | 'quickbooks' | 'stripe'
export interface CreateInvoiceResult { ok: true; invoiceId: string; number?: string; provider: InvoiceProviderId; sync_status: string; external_url?: string | null; idempotent: boolean }
export type CreateInvoiceReturn = CreateInvoiceResult | { ok: false; error: string }

async function invoiceLines(tenantId: string, invoiceId: string) {
  const { data } = await admin().from('sales_document_lines').select('description, quantity, unit_price_cents, line_total_cents').eq('tenant_id', tenantId).eq('document_type', 'invoice').eq('document_id', invoiceId).order('sort_order')
  return (data ?? []).map((l) => ({ description: (l.description as string) ?? null, quantity: l.quantity as number, unit_price_cents: l.unit_price_cents as number, line_total_cents: l.line_total_cents as number }))
}

async function syncQuickBooks(tenantId: string, actor: string, invoiceId: string, proposalId: string): Promise<{ sync_status: string; external_id?: string; error?: string }> {
  const { data: inv } = await admin().from('invoices').select('number, contact_id, external_id').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle()
  if (!inv) return { sync_status: 'failed', error: 'invoice_not_found' }
  if (inv.external_id) return { sync_status: 'synced', external_id: inv.external_id as string } // idempotent — never double-create in QB
  await admin().from('invoices').update({ provider: 'quickbooks', sync_status: 'pending', updated_at: now() }).eq('id', invoiceId)
  const contact = inv.contact_id ? (await admin().from('contacts').select('name, email').eq('id', inv.contact_id).maybeSingle()).data : null
  try {
    const res = await createQuickBooksInvoice(tenantId, { customerName: (contact?.name as string) || 'Customer', customerEmail: (contact?.email as string) ?? null, lines: await invoiceLines(tenantId, invoiceId), docNumber: inv.number as string })
    await admin().from('invoices').update({ external_id: res.qbInvoiceId, provider_customer_id: res.customerId, sync_status: 'synced', provider_synced_at: now(), sync_error: null, updated_at: now() }).eq('id', invoiceId)
    await logActivity(tenantId, proposalId, 'converted_invoice', { actor, message: `QuickBooks invoice created (id ${res.qbInvoiceId})`, meta: { provider: 'quickbooks', qb_invoice_id: res.qbInvoiceId } })
    return { sync_status: 'synced', external_id: res.qbInvoiceId }
  } catch (e) {
    const msg = (e as Error).message
    await admin().from('invoices').update({ sync_status: 'failed', sync_error: msg, updated_at: now() }).eq('id', invoiceId)
    await logActivity(tenantId, proposalId, 'converted_invoice', { actor, message: `QuickBooks sync failed: ${msg}`, meta: { provider: 'quickbooks', error: msg } })
    return { sync_status: 'failed', error: msg }
  }
}

async function attachStripeLink(tenantId: string, actor: string, invoiceId: string, proposalId: string, appUrl: string): Promise<{ sync_status: string; external_url?: string; error?: string }> {
  const accountId = await getConnectedAccountId(tenantId)
  if (!accountId) return { sync_status: 'failed', error: 'stripe_not_connected' }
  const { data: inv } = await admin().from('invoices').select('number, total_cents, currency, contact_id, external_url').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle()
  if (!inv) return { sync_status: 'failed', error: 'invoice_not_found' }
  if (inv.external_url) return { sync_status: 'synced', external_url: inv.external_url as string }
  const contact = inv.contact_id ? (await admin().from('contacts').select('email').eq('id', inv.contact_id).maybeSingle()).data : null
  const brand = await getBranding(tenantId)
  try {
    const res = await createConnectCheckout(admin(), { tenantId, businessName: brand.business_name, accountId, appUrl, amount: inv.total_cents as number, productName: `Invoice ${inv.number}`, currency: (inv.currency as string) || 'usd', recordAmount: inv.total_cents as number, customerEmail: (contact?.email as string) ?? null })
    await admin().from('invoices').update({ provider: 'stripe', external_url: res.url, external_id: res.sessionId, sync_status: 'synced', provider_synced_at: now(), sync_error: null, updated_at: now() }).eq('id', invoiceId)
    await logActivity(tenantId, proposalId, 'converted_invoice', { actor, message: 'Stripe payment link created (not a Stripe invoice)', meta: { provider: 'stripe', session: res.sessionId } })
    return { sync_status: 'synced', external_url: res.url }
  } catch (e) {
    const msg = (e as Error).message
    await admin().from('invoices').update({ provider: 'stripe', sync_status: 'failed', sync_error: msg, updated_at: now() }).eq('id', invoiceId)
    return { sync_status: 'failed', error: msg }
  }
}

export async function createInvoiceFromProposal(tenantId: string, actor: string, proposalId: string, opts: { provider: InvoiceProviderId; appUrl: string }): Promise<CreateInvoiceReturn> {
  await logActivity(tenantId, proposalId, 'converted_invoice', { actor, message: `Create invoice started (provider: ${opts.provider})`, meta: { provider: opts.provider, phase: 'started' } })
  const conv = await convertProposalToInvoice(tenantId, actor, proposalId) // idempotent internal record
  if (!conv.ok) return { ok: false, error: conv.error }
  await admin().from('invoices').update({ provider: opts.provider }).eq('tenant_id', tenantId).eq('id', conv.invoiceId)

  if (opts.provider === 'scalix') {
    return { ok: true, invoiceId: conv.invoiceId, number: conv.number, provider: 'scalix', sync_status: 'none', idempotent: conv.idempotent }
  }
  if (opts.provider === 'quickbooks') {
    const r = await syncQuickBooks(tenantId, actor, conv.invoiceId, proposalId)
    return { ok: true, invoiceId: conv.invoiceId, number: conv.number, provider: 'quickbooks', sync_status: r.sync_status, idempotent: conv.idempotent }
  }
  const r = await attachStripeLink(tenantId, actor, conv.invoiceId, proposalId, opts.appUrl)
  return { ok: true, invoiceId: conv.invoiceId, number: conv.number, provider: 'stripe', sync_status: r.sync_status, external_url: r.external_url ?? null, idempotent: conv.idempotent }
}

// Retry a failed provider sync for an existing internal invoice (idempotent — never double-creates externally).
export async function retryInvoiceSync(tenantId: string, actor: string, invoiceId: string, appUrl: string): Promise<{ ok: true; sync_status: string; external_url?: string | null } | { ok: false; error: string }> {
  const { data: inv } = await admin().from('invoices').select('provider, source_document_id').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle()
  if (!inv) return { ok: false, error: 'not_found' }
  const proposalId = (inv.source_document_id as string) || invoiceId
  if (inv.provider === 'quickbooks') { const r = await syncQuickBooks(tenantId, actor, invoiceId, proposalId); return r.error && r.sync_status === 'failed' ? { ok: false, error: r.error } : { ok: true, sync_status: r.sync_status } }
  if (inv.provider === 'stripe') { const r = await attachStripeLink(tenantId, actor, invoiceId, proposalId, appUrl); return r.error ? { ok: false, error: r.error } : { ok: true, sync_status: r.sync_status, external_url: r.external_url ?? null } }
  return { ok: true, sync_status: 'none' }
}
