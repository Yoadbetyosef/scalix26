// Going-forward lifecycle event instrumentation → cc_lifecycle_events. Turns churn/billing from
// "derived from current state" into event-sourced actual from CC_RELIABLE_FROM onward. Idempotent on the
// Stripe event id; event timestamp comes from Stripe (not processing time); best-effort — a failure here
// NEVER breaks the Stripe webhook, and errors are observable without logging sensitive data (ids only).

export type LifecycleEventKind =
  | 'cancellation' | 'failed_payment' | 'recovery' | 'downgrade' | 'upgrade' | 'pause' | 'reactivation'
  | 'refund' | 'chargeback' | 'chargeback_reversed' | 'subscription_changed' | 'subscription_created'

export interface LifecycleEventInput {
  tenantId: string | null
  kind: LifecycleEventKind
  sourceEventId: string          // Stripe event id — idempotency anchor
  occurredAt?: string | null     // Stripe event timestamp (ISO)
  mrrCents?: number | null
  previousState?: string | null
  newState?: string | null
  metadata?: Record<string, unknown>
}

// Do NOT infer upgrade/downgrade from price when the plan mapping is unreliable — classify as
// subscription_changed and keep the raw price identifiers in metadata for later resolution.
export function classifySubscriptionChange(a: {
  prevAmountCents?: number | null; newAmountCents?: number | null; planMappingReliable: boolean
}): 'upgrade' | 'downgrade' | 'subscription_changed' {
  if (!a.planMappingReliable) return 'subscription_changed'
  if (a.prevAmountCents != null && a.newAmountCents != null) {
    if (a.newAmountCents > a.prevAmountCents) return 'upgrade'
    if (a.newAmountCents < a.prevAmountCents) return 'downgrade'
  }
  return 'subscription_changed'
}

export interface LifecycleInsertResult { duplicate: boolean; error?: string }
export interface LifecycleDeps { insert(row: Record<string, unknown>): Promise<LifecycleInsertResult> }

const dbDeps: LifecycleDeps = {
  async insert(row) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { error } = await createAdminClient().from('cc_lifecycle_events').insert(row)
    if (!error) return { duplicate: false }
    if (error.code === '23505') return { duplicate: true } // already recorded — fine
    return { duplicate: false, error: error.message }
  },
}
let deps: LifecycleDeps = dbDeps
export function __setLifecycleDepsForTests(d: LifecycleDeps | null) { deps = d ?? dbDeps }

export async function recordLifecycleEvent(e: LifecycleEventInput): Promise<{ recorded: boolean; duplicate: boolean }> {
  const row = {
    tenant_id: e.tenantId, kind: e.kind, mrr_cents: e.mrrCents ?? null, source: 'stripe_webhook',
    source_event_id: e.sourceEventId, idempotency_key: `cc:${e.sourceEventId}:${e.kind}`,
    occurred_at: e.occurredAt ?? undefined, previous_state: e.previousState ?? null, new_state: e.newState ?? null,
    metadata: e.metadata ?? null,
  }
  try {
    const r = await deps.insert(row)
    if (r.error) console.warn(`[cc] lifecycle insert error kind=${e.kind} event=${e.sourceEventId}: ${r.error}`)
    return { recorded: !r.duplicate && !r.error, duplicate: r.duplicate }
  } catch (err) {
    console.warn(`[cc] lifecycle insert threw kind=${e.kind} event=${e.sourceEventId}: ${err instanceof Error ? err.message : 'error'}`)
    return { recorded: false, duplicate: false } // never propagate — the Stripe webhook must still succeed
  }
}
