import { createAdminClient } from '@/lib/supabase/server'

// HOW THEY PAY YOU — typed once, per tenant.
//
// Bank details do not change per invoice, and asking for them on every one is how they end up
// inconsistent. This is the SOURCE; what a customer was actually sent is snapshotted onto the invoice
// at issue (invoices.payment_instructions), so changing these details never rewrites a document
// somebody already has.
//
// It is not terms and conditions. It is the line the customer acts on, and the screen renders it at
// normal weight for that reason.

export interface InvoiceSettings {
  paymentInstructions: string | null
  netDays: number
}

/** 14 is a common default and a legal one nowhere. An owner who has never opened the form gets it. */
export const DEFAULT_NET_DAYS = 14

export async function readInvoiceSettings(tenantId: string): Promise<InvoiceSettings> {
  const { data } = await createAdminClient()
    .from('invoice_settings').select('payment_instructions, net_days').eq('tenant_id', tenantId).maybeSingle()
  return {
    paymentInstructions: (data?.payment_instructions as string) ?? null,
    netDays: Number(data?.net_days ?? DEFAULT_NET_DAYS),
  }
}

export async function writeInvoiceSettings(
  tenantId: string,
  input: { paymentInstructions: string | null; netDays: number },
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const netDays = Math.min(365, Math.max(0, Math.round(input.netDays)))
  const { error } = await createAdminClient().from('invoice_settings').upsert({
    tenant_id: tenantId,
    payment_instructions: input.paymentInstructions?.trim() || null,
    net_days: netDays,
    updated_at: new Date().toISOString(),
    updated_by: actor,
  }, { onConflict: 'tenant_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
