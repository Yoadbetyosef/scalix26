import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'

// Shared webhook deduplication. ONE implementation for every provider — call `claimEvent` AFTER
// signature verification (a forged event must never reach the store), then `completeEvent` on success
// or `failEvent` on failure. The unique(provider, event_key) constraint makes concurrent duplicate
// deliveries race safely: exactly one INSERT wins and processes; the rest are told to skip.

export type Provider = 'twilio' | 'meta' | 'resend'
// `unavailable` = the dedup store itself failed (e.g. the migration wasn't run). In Production/Preview
// the webhook route MUST refuse to process (return 503) so the provider retries — we never process a
// webhook without replay protection. Only local dev bypasses a missing table.
export interface Claim { id: string | null; duplicate: boolean; unavailable?: boolean }

// A stable fingerprint when no clean provider id exists (Meta batches, voice multi-turn): identical
// retries hash the same; distinct events differ.
export function fingerprint(...parts: (string | undefined | null)[]): string {
  return createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 40)
}

// Events stuck 'processing' longer than this are assumed crashed and may be re-claimed (never permanently
// suppress an event that failed before completing).
const STALE_MS = 10 * 60 * 1000

// FAIL-CLOSED helper: a dedup store failure must never silently drop replay protection in prod/preview.
function unavailable(where: string, err: unknown): Claim {
  console.error(`[idempotency] processed_webhook_events unavailable at ${where}:`, err)
  if (process.env.NODE_ENV === 'development') return { id: null, duplicate: false } // local dev bypass ONLY
  return { id: null, duplicate: false, unavailable: true } // → route returns 503, provider retries
}

export async function claimEvent(provider: Provider, eventKey: string, eventType: string, tenantId?: string | null): Promise<Claim> {
  const db = createAdminClient()
  let ins
  try {
    // Insert-first: the winner of the unique(provider,event_key) constraint gets to process.
    ins = await db.from('processed_webhook_events')
      .insert({ provider, event_key: eventKey, event_type: eventType, tenant_id: tenantId ?? null, status: 'processing' })
      .select('id').single()
  } catch (e) {
    return unavailable('insert', e)
  }
  if (!ins.error && ins.data) return { id: ins.data.id, duplicate: false }

  // A UNIQUE violation (23505) is a genuine duplicate. ANY OTHER error (e.g. 42P01 undefined_table when
  // the migration wasn't run) is an infrastructure failure — fail closed, do NOT process.
  if (ins.error && ins.error.code !== '23505') return unavailable(`insert(${ins.error.code})`, ins.error.message)

  const { data: existing, error: selErr } = await db.from('processed_webhook_events')
    .select('id, status, first_received_at').eq('provider', provider).eq('event_key', eventKey).maybeSingle()
  if (selErr) return unavailable('select', selErr.message)
  if (!existing) return unavailable('conflict-without-row', 'row vanished after 23505')

  if (existing.status === 'processed') return { id: existing.id, duplicate: true } // already done → skip
  const stale = Date.now() - new Date(existing.first_received_at).getTime() > STALE_MS
  if (existing.status === 'failed' || stale) {
    // Retryable: re-claim and re-process (never permanently suppress a failed/crashed event).
    await db.from('processed_webhook_events').update({ status: 'processing', first_received_at: new Date().toISOString() }).eq('id', existing.id)
    return { id: existing.id, duplicate: false }
  }
  // Another delivery is processing right now → skip to avoid a double action.
  return { id: existing.id, duplicate: true }
}

export async function completeEvent(claim: Claim, tenantId?: string | null): Promise<void> {
  if (!claim.id) return
  try {
    await createAdminClient().from('processed_webhook_events')
      .update({ status: 'processed', processed_at: new Date().toISOString(), ...(tenantId ? { tenant_id: tenantId } : {}) })
      .eq('id', claim.id)
  } catch { /* best-effort */ }
}

export async function failEvent(claim: Claim): Promise<void> {
  if (!claim.id) return
  try {
    await createAdminClient().from('processed_webhook_events').update({ status: 'failed' }).eq('id', claim.id)
  } catch { /* best-effort */ }
}
