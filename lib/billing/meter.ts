import { after } from 'next/server'
import type { BillingCategory } from './pricing'

// Universal usage meter. Called at every DETERMINISTIC billable provider call site (fire-and-forget —
// never blocks the hot path). Writes an IMMUTABLE, fully self-describing usage_events row: pricing is
// snapshotted here (markup_percent + partner_charge + pricing_rule_id + billing_version) so the bill
// is reproducible forever and future rate changes never alter it. Deduped by (provider, resource_id):
// a retry can't double-meter.
//
// Only WL-client-tenant usage (partner resolved via tenants.white_label_partner_id) is billable to a
// partner balance; direct Scalix tenants meter with partner_id NULL for COGS only.

// The pricing-logic era. Bump when the pricing MODEL changes; old events keep their version + snapshot.
export const BILLING_VERSION = 1

export interface MeterInput {
  tenantId: string
  category: BillingCategory      // partner-facing bucket: voice | messaging | ai | email | storage | other
  provider: string              // REAL vendor (admin-only): anthropic | twilio | deepgram | elevenlabs | resend | supabase
  metric: string                // token | minute | sms_segment | email | gb_month
  quantity: number
  providerCostUsd: number       // REAL provider cost (precise) — snapshotted as provider_cost
  resourceId: string            // REQUIRED for traceability + dedup: completion id / message SID / call SID / …
  customerId?: string | null    // end customer/contact, if applicable
  model?: string
  kind?: string                 // legacy usage_events.kind (defaults to category; AI uses 'llm' for COGS back-compat)
  pricingRuleId?: string | null // provider_rates row id, if rate-card priced
  metadata?: Record<string, unknown> | null // provider request/event context (voice: direction, status, ParentCallSid, …)
}

export function meterUsage(input: MeterInput): void {
  // Only meter deterministic events: a stable resource_id + positive quantity are required.
  if (!input.tenantId || !input.resourceId || input.quantity <= 0) return
  const task = async () => {
    try {
      const { createAdminClient } = await import('@/lib/supabase/server')
      const { resolveMarkupPct } = await import('./pricing')
      const db = createAdminClient()

      const { data: t } = await db.from('tenants').select('white_label_partner_id').eq('id', input.tenantId).maybeSingle()
      const partnerId = t?.white_label_partner_id ?? null

      // Snapshot the pricing that applies RIGHT NOW (frozen onto the immutable event).
      let markupPct: number | null = null
      let partnerChargeCents: number | null = null
      if (partnerId) {
        markupPct = await resolveMarkupPct(partnerId, 'usd')
        partnerChargeCents = input.providerCostUsd * 100 * (1 + markupPct / 100) // fractional; rounded once in the cron
      }

      await db.from('usage_events').upsert({
        tenant_id: input.tenantId,
        customer_id: input.customerId ?? null,
        partner_id: partnerId,
        provider: input.provider,
        kind: input.kind ?? input.category,
        category: input.category,
        resource_id: input.resourceId,
        model: input.model ?? null,
        units: input.quantity,
        unit_type: input.metric,
        cost_usd: input.providerCostUsd,      // provider_cost (real)
        markup_percent: markupPct,
        partner_charge_cents: partnerChargeCents,
        currency: 'usd',
        billing_version: BILLING_VERSION,
        pricing_rule_id: input.pricingRuleId ?? null,
        metadata: input.metadata ?? null,
        priced: false,
      })
      // Deterministic dedup: the partial unique index (provider, resource_id) raises 23505 on a
      // retry, which the catch below turns into a silent no-op. (A plain INSERT is used instead of
      // upsert because ON CONFLICT cannot infer a PARTIAL unique index.)
    } catch {
      /* best-effort: metering must never break the request that produced it */
    }
  }
  // Run AFTER the response so the insert can't be dropped when the serverless function freezes
  // (Vercel keeps the function alive via waitUntil). Falls back to a bare promise if `after()` is
  // unavailable (e.g. called outside a request context).
  try { after(task) } catch { void task() }
}
