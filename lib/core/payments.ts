import { createAdminClient } from '@/lib/supabase/server'
import type { DocType } from './documents'

// Payments ledger: deposits/partials/refunds against a document. Balance + status are DERIVED server-side
// (never client-set). The atomic + idempotent core_apply_payment RPC is the write path.
const admin = () => createAdminClient()

// Pure derivation (mirrors the RPC) — unit-tested, and reused for read-side summaries.
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded'
export function derivePaymentStatus(totalCents: number, paidCents: number): PaymentStatus {
  if (paidCents < 0) return 'refunded'
  if (paidCents <= 0) return 'unpaid'
  if (paidCents >= totalCents) return 'paid'
  return 'partial'
}

export interface ApplyInput { kind: 'charge' | 'deposit' | 'refund' | 'adjustment'; amountCents: number; currency?: string; providerRef?: string | null; idempotencyKey?: string | null }
export async function applyPayment(tenantId: string, docType: DocType | 'order', docId: string, input: ApplyInput, actor: string) {
  const { data, error } = await admin().rpc('core_apply_payment', {
    p_tenant: tenantId, p_doc_type: docType, p_doc_id: docId, p_kind: input.kind, p_amount_cents: input.amountCents,
    p_currency: input.currency ?? 'usd', p_provider_ref: input.providerRef ?? null, p_key: input.idempotencyKey ?? null, p_actor: actor,
  })
  if (error) return { ok: false as const, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as { ok: boolean; total_cents?: number; paid_cents?: number; balance_cents?: number; status?: PaymentStatus; idempotent?: boolean }
}

export async function getPaymentSummary(tenantId: string, docType: DocType, docId: string) {
  const table = `${docType}s`
  const [{ data: doc }, { data: allocs }] = await Promise.all([
    admin().from(table).select('total_cents').eq('tenant_id', tenantId).eq('id', docId).maybeSingle(),
    admin().from('payment_allocations').select('*').eq('tenant_id', tenantId).eq('document_type', docType).eq('document_id', docId).order('created_at'),
  ])
  const total = Number(doc?.total_cents ?? 0)
  const paid = ((allocs ?? []) as Array<{ amount_cents: number }>).reduce((s, a) => s + Number(a.amount_cents), 0)
  return { total_cents: total, paid_cents: paid, balance_cents: total - paid, status: derivePaymentStatus(total, paid), allocations: allocs ?? [] }
}
