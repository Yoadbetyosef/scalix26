import type { SupabaseClient } from '@supabase/supabase-js'

// ── ADDITIONAL CHARGES ──────────────────────────────────────────────────────────────────────────
//
// Everything on an invoice that is not the piece itself: shipping, insurance, the CAD fee, the card
// surcharge, a discount. Her previous system (Diamond Track) had a charges section on every
// estimate with a type, a selling amount and a cost, and without one an estimate whose shipping or
// CAD fee had been agreed could not become a correct invoice — so it did not.
//
// The model, kept deliberately close to that:
//
//   · one row per charge, on its own table (order_charges), never disguised as a line item — a
//     line is a piece the factory makes and the approval page lists; a charge is not;
//   · `amount_cents` is the SELLING amount the customer sees, SIGNED: discounts and reimbursements
//     are stored negative, so every sum in the system is a plain sum and nobody has to remember
//     which types subtract;
//   · `cost_cents` is internal — what the charge cost the business. Never on a customer document;
//   · the order's subtotal_cents is lines + charges, so the tax snapshot, the totals, the balance and
//     the order list all include them without each learning about charges.
//
// Tax: charges sit inside the taxable subtotal like the items do. In BC (and federally) delivery,
// insurance and service fees billed with taxable goods are part of the taxable supply, and a
// discount reduces it. One rule, the common case; nothing per-charge to get wrong.

export const CHARGE_TYPES = [
  { key: 'shipping', label: 'Shipping' },
  { key: 'shipping_insured', label: 'Shipping & insurance' },
  { key: 'shipping_overnight', label: 'Overnight shipping' },
  { key: 'shipping_duties', label: 'Shipping duties' },
  { key: 'adjustment', label: 'Adjustment' },
  { key: 'appraisal', label: 'Appraisal' },
  { key: 'cad_cam', label: 'CAD/CAM' },
  { key: 'casting', label: 'Casting' },
  { key: 'certificate', label: 'Certificate' },
  { key: 'commission', label: 'Commission' },
  { key: 'credit_card_fee', label: 'Credit card fee' },
  { key: 'currency_exchange', label: 'Currency exchange' },
  { key: 'custom_jewellery', label: 'Custom jewellery' },
  { key: 'discount', label: 'Discount' },
  { key: 'reimbursement', label: 'Reimbursement' },
  { key: 'general', label: 'General charge' },
] as const

export type ChargeType = (typeof CHARGE_TYPES)[number]['key']
export const CHARGE_TYPE_KEYS = CHARGE_TYPES.map((t) => t.key) as [ChargeType, ...ChargeType[]]

/** Types that always take money OFF the invoice. An adjustment may go either way, so it is not here. */
export const CREDIT_TYPES: ReadonlySet<ChargeType> = new Set<ChargeType>(['discount', 'reimbursement'])

export const chargeLabel = (t: string): string => CHARGE_TYPES.find((c) => c.key === t)?.label ?? 'Charge'

export interface OrderCharge {
  id?: string
  chargeType: ChargeType
  description: string | null
  /** Selling amount, signed: negative for a discount / reimbursement / downward adjustment. */
  amountCents: number
  /** What it cost the business. Internal only; null = not recorded. */
  costCents: number | null
}

/**
 * The sign rule, in one place, applied on the way IN. A discount typed as 50 means 50 off; a
 * discount typed as -50 means the same. An adjustment keeps the sign it was given.
 */
export function signedAmount(type: ChargeType, cents: number): number {
  const n = Math.round(cents)
  return CREDIT_TYPES.has(type) ? -Math.abs(n) : n
}

export const chargesTotal = (charges: Pick<OrderCharge, 'amountCents'>[]): number =>
  charges.reduce((s, c) => s + (Number.isFinite(c.amountCents) ? c.amountCents : 0), 0)

export const chargesCost = (charges: Pick<OrderCharge, 'costCents'>[]): number | null => {
  const known = charges.map((c) => c.costCents).filter((c): c is number => c !== null && c !== undefined)
  return known.length ? known.reduce((s, n) => s + n, 0) : null
}

const chargeRow = (r: Record<string, unknown>): OrderCharge => ({
  id: r.id as string,
  chargeType: (CHARGE_TYPE_KEYS as string[]).includes(r.charge_type as string) ? (r.charge_type as ChargeType) : 'general',
  description: (r.description as string) ?? null,
  amountCents: Number(r.amount_cents ?? 0),
  costCents: r.cost_cents == null ? null : Number(r.cost_cents),
})

/** True when the table is not there yet — add_order_charges.sql not run. */
export const chargesMissing = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /order_charges/.test(error.message ?? ''))

export const CHARGES_MIGRATION = 'supabase/migrations/add_order_charges.sql'

/** An order's charges, in order. Empty (never a throw) when the table does not exist yet. */
export async function readCharges(db: SupabaseClient, tenantId: string, orderId: string): Promise<OrderCharge[]> {
  const { data, error } = await db.from('order_charges').select('*').eq('tenant_id', tenantId).eq('order_id', orderId).order('display_order')
  if (error) return []
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(chargeRow)
}

/**
 * Replace an order's charges with this set. Same shape as the line items: delete then insert, with
 * the previous rows put back if the insert is refused. Returns the error to surface, or null.
 */
export async function replaceCharges(db: SupabaseClient, tenantId: string, orderId: string, charges: OrderCharge[]): Promise<{ error: string | null; missing: boolean }> {
  const { data: previous, error: readErr } = await db.from('order_charges').select('*').eq('tenant_id', tenantId).eq('order_id', orderId)
  if (chargesMissing(readErr)) return { error: charges.length ? `Additional charges are not enabled yet — run ${CHARGES_MIGRATION} in the Supabase SQL editor.` : null, missing: true }
  await db.from('order_charges').delete().eq('tenant_id', tenantId).eq('order_id', orderId)
  if (!charges.length) return { error: null, missing: false }
  const rows = charges.map((c, i) => ({
    tenant_id: tenantId, order_id: orderId, charge_type: c.chargeType,
    description: (c.description ?? '').trim() || null,
    amount_cents: signedAmount(c.chargeType, c.amountCents),
    cost_cents: c.costCents == null ? null : Math.max(0, Math.round(c.costCents)),
    display_order: i,
  }))
  const { error } = await db.from('order_charges').insert(rows)
  if (error) {
    if (previous?.length) await db.from('order_charges').insert(previous)
    return { error: `The additional charges could not be saved: ${error.message}`, missing: false }
  }
  return { error: null, missing: false }
}
