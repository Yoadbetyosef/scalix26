// Billing gate — the fast, cached PRE-FLIGHT for billable WL operations (AI, voice, SMS). Answers one
// question before we spend money on a WL client tenant's behalf: is the owning partner allowed to run?
//
// Philosophy (deliberately NOT symmetric with the cron's fail-closed money path):
//   • FAIL OPEN. This guards live customer traffic — a transient DB hiccup, a missing wallet row, or
//     billing being switched off must NEVER silence a paying partner's assistant. We only ever block on
//     a DEFINITIVE negative signal read straight from the cached wallet.
//   • Block signals (all read from partner_balances, no computation on the hot path):
//       - status === 'paused'                          → funds exhausted, reload already failed
//       - available (balance − pending) <= 0           → depleted this instant, even if not yet flipped
//       - platform_fee_status payment_required/canceled → $97 platform subscription lapsed past its
//         grace window (Phase 7). NOTE: plain 'past_due' does NOT block — it is inside the grace window.
//   • Only WL-client tenants are gated. Direct Scalix tenants (no white_label_partner_id) always pass.
//   • Entirely inert until WL_BILLING_ENABLED === 'true' — same kill-switch as the meter/cron.
//
// Pausing itself is owned by reload.ts::ensureFunded (reload-before-pause). This module only READS the
// resulting status; it never mutates the wallet. DB access is behind an injectable `deps` seam so the
// decision matrix is fully unit-testable with no database.

export type GateReason = 'paused_balance' | 'depleted' | 'platform_unpaid'

export interface GateResult {
  ok: boolean
  /** Set only when ok === false. */
  reason?: GateReason
  /** The owning WL partner, when one was resolved (null for direct Scalix tenants). */
  partnerId?: string | null
}

// The minimal wallet projection the gate needs. Kept tiny so the lookup stays a single fast row read.
export interface GateRow {
  status: 'active' | 'paused' | 'payment_required'
  balance_cents: number
  pending_charge_cents: number
  platform_fee_status: string | null
}

export interface GateDeps {
  resolvePartner(tenantId: string): Promise<string | null>
  loadGateRow(partnerId: string): Promise<GateRow | null>
}

// Real deps: lazy-imported so unit tests never load next/headers or the Supabase client.
const dbDeps: GateDeps = {
  async resolvePartner(tenantId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient()
      .from('tenants').select('white_label_partner_id').eq('id', tenantId).maybeSingle()
    return data?.white_label_partner_id ?? null
  },
  async loadGateRow(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partner_balances')
      .select('status, balance_cents, pending_charge_cents, platform_fee_status')
      .eq('partner_id', partnerId).maybeSingle()
    return (data as GateRow) || null
  },
}

let deps: GateDeps = dbDeps
export function __setGateDepsForTests(d: GateDeps | null) { deps = d ?? dbDeps }

// Platform-subscription states that must stop new billable work. NOTE (Phase 7): 'past_due' is
// intentionally NOT here — a failed $97 invoice opens a configurable GRACE window during which service
// continues. Only after grace expires does the dunning sweep flip the partner to 'payment_required'
// (see lib/billing/platform-fee.ts::expirePlatformGraceIfDue); that terminal state — with 'canceled' —
// is what gates here.
const PLATFORM_BLOCKED = new Set(['payment_required', 'canceled'])

export function billingGateEnabled(): boolean {
  return process.env.WL_BILLING_ENABLED === 'true'
}

const PASS: GateResult = { ok: true }

// Pre-flight a billable WL operation. Pass a tenantId (resolved to its owning partner) or a partnerId
// directly (voice/SMS paths that already hold it). Returns PASS for anything that isn't a WL client
// tenant with a definitively blocked wallet — including every error path.
export async function assertPartnerActive(
  input: { tenantId?: string | null; partnerId?: string | null },
): Promise<GateResult> {
  if (!billingGateEnabled()) return PASS
  try {
    let partnerId = input.partnerId ?? null
    if (!partnerId && input.tenantId) partnerId = await deps.resolvePartner(input.tenantId)
    if (!partnerId) return PASS // direct Scalix tenant — not billed to a partner, never gated

    const w = await deps.loadGateRow(partnerId)
    if (!w) return { ...PASS, partnerId } // no wallet yet → not onboarded to prepaid; keep serving

    if (PLATFORM_BLOCKED.has(w.platform_fee_status ?? '')) {
      return { ok: false, reason: 'platform_unpaid', partnerId }
    }
    if (w.status === 'paused') return { ok: false, reason: 'paused_balance', partnerId }
    const available = Number(w.balance_cents) - Number(w.pending_charge_cents)
    if (available <= 0) return { ok: false, reason: 'depleted', partnerId }

    return { ...PASS, partnerId }
  } catch {
    // Fail OPEN: never break live traffic because the gate lookup itself failed.
    return PASS
  }
}

// Partner-safe, brand-neutral copy shown to end callers/texters when their assistant is paused. Says
// nothing about balances, vendors, or Scalix — just that the assistant is briefly unavailable.
export const PAUSED_VOICE_MESSAGE =
  "Thanks for calling. Our assistant is briefly unavailable right now. Please try again a little later, or leave us a message. Goodbye."

// Stable machine code + safe human message for JSON API consumers of a billable action (dashboard AI
// like Ask Amy, Brain run). 402 = Payment Required. Never exposes balance math or vendor names.
export const BILLING_PAUSED_CODE = 'billing_payment_required'
export const PAUSED_API_MESSAGE =
  'This workspace is temporarily paused. Add funds to resume — your existing data is safe.'
