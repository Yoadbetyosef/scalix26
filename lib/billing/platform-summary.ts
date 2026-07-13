import { PLATFORM_PRICE_CENTS, platformFeeEnabled, type PlatformStatus } from './platform-fee'
import { countActiveClients } from './platform-clients'

// Partner-facing PLATFORM FEE summary — the $97/mo-per-active-client subscription, shown on the Balance
// page in a section SEPARATE from the usage wallet (the two billing systems are never mixed). All fields
// are partner-safe (no provider economics). Read-only; computes nothing chargeable.

export interface PlatformInvoiceView { type: 'invoice_paid' | 'invoice_failed'; amountCents: number; at: string }

export interface PlatformFeeSummary {
  enabled: boolean
  status: PlatformStatus
  activeClients: number
  billedQuantity: number
  perClientCents: number
  monthlyTotalCents: number
  nextInvoiceDate: string | null
  graceUntil: string | null
  hasSubscription: boolean
  recentInvoices: PlatformInvoiceView[]
}

export async function getPlatformFeeSummary(partnerId: string): Promise<PlatformFeeSummary> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()

  const [{ activeClients }, balRes, invRes] = await Promise.all([
    countActiveClients(partnerId),
    db.from('partner_balances')
      .select('platform_subscription_id, platform_active_qty, platform_fee_status, platform_grace_until, platform_current_period_end')
      .eq('partner_id', partnerId).maybeSingle(),
    db.from('platform_subscription_events')
      .select('event_type, amount_cents, created_at')
      .eq('partner_id', partnerId).in('event_type', ['invoice_paid', 'invoice_failed'])
      .order('created_at', { ascending: false }).limit(12),
  ])

  const bal = balRes.data
  const billedQuantity = Number(bal?.platform_active_qty ?? 0)
  const status = (bal?.platform_fee_status as PlatformStatus) ?? 'none'

  return {
    enabled: platformFeeEnabled(),
    status,
    activeClients,
    billedQuantity,
    perClientCents: PLATFORM_PRICE_CENTS,
    // Bill on the synced quantity when a subscription exists; otherwise project from the live count.
    monthlyTotalCents: (bal?.platform_subscription_id ? billedQuantity : activeClients) * PLATFORM_PRICE_CENTS,
    nextInvoiceDate: bal?.platform_current_period_end ?? null,
    graceUntil: bal?.platform_grace_until ?? null,
    hasSubscription: !!bal?.platform_subscription_id,
    recentInvoices: ((invRes.data as Array<{ event_type: string; amount_cents: number | null; created_at: string }>) || []).map((e) => ({
      type: e.event_type as PlatformInvoiceView['type'], amountCents: Number(e.amount_cents ?? 0), at: e.created_at,
    })),
  }
}
