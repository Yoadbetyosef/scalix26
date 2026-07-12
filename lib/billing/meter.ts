import type { BillingCategory } from './pricing'

// Universal usage meter. Called at every billable provider call site (fire-and-forget — never blocks
// the hot path, mirroring lib/cost/track.ts::trackLlm). Records the REAL provider cost into
// usage_events and resolves the owning White Label partner via tenants.white_label_partner_id.
//
// Only WL-client-tenant usage (partner_id set) is billable to a partner balance; direct Scalix
// tenants still meter (partner_id NULL) for admin cost/COGS but are never debited from a wallet.
// Pricing + debiting happen asynchronously in the billing cron (near-real-time), which aggregates
// per partner+category before rounding — so sub-cent events are never lost.

export interface MeterInput {
  tenantId: string
  category: BillingCategory     // partner-facing bucket: voice | messaging | ai | email | storage | other
  provider: string             // internal label (scalix_ai / scalix_voice / …), never shown to partners
  metric: string               // token | minute | sms_segment | email | gb_month
  quantity: number
  providerCostUsd: number      // REAL provider cost (precise; kept in usage_events.cost_usd numeric)
  model?: string
  idempotencyKey?: string      // optional per-usage dedupe (e.g. a provider message SID)
}

export function meterUsage(input: MeterInput): void {
  if (!input.tenantId || input.quantity <= 0) return
  ;(async () => {
    try {
      const { createAdminClient } = await import('@/lib/supabase/server')
      const db = createAdminClient()
      const { data: t } = await db.from('tenants').select('white_label_partner_id').eq('id', input.tenantId).maybeSingle()
      await db.from('usage_events').insert({
        tenant_id: input.tenantId,
        kind: input.category,
        category: input.category,
        provider: input.provider,
        model: input.model ?? null,
        units: input.quantity,
        unit_type: input.metric,
        cost_usd: input.providerCostUsd,
        partner_id: t?.white_label_partner_id ?? null,   // NULL for direct Scalix tenants → not partner-billed
        priced: false,
        ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      })
    } catch {
      /* best-effort: metering must never break the request that produced it */
    }
  })()
}
