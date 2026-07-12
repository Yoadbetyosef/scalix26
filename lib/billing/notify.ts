// Balance notices — drive the partner's bell + email off wallet state transitions ONLY. The billing
// cron runs every 1-2 minutes, so a naive "balance < threshold → notify" would spam a row every tick.
// Instead we persist the last-announced notice state on partner_balances.balance_notice_state and fire
// exactly once per CROSSING (none → low → paused, and silent recovery back down). The partner_notifications
// row reuses the existing bell + realtime feed; email is best-effort (mirrors economics.ts::recordConversion).
//
// DB/email access is behind an injectable `deps` seam so the crossing state machine is fully unit-testable.

export type NoticeState = 'none' | 'low' | 'paused'

export interface NoticeWallet {
  balance_cents: number
  low_balance_threshold_cents: number | null
  status: 'active' | 'paused' | 'payment_required'
  balance_notice_state: NoticeState | null
  currency: string
}

export interface NoticeDeps {
  loadWallet(partnerId: string): Promise<NoticeWallet | null>
  setNoticeState(partnerId: string, state: NoticeState): Promise<void>
  insertNotification(partnerId: string, n: { kind: string; title: string; body: string; link: string }): Promise<void>
  emailPartner(partnerId: string, state: Exclude<NoticeState, 'none'>, wallet: NoticeWallet): Promise<void>
}

// PURE: what notice SHOULD be shown for this wallet right now. Paused (status or zero balance) wins over low.
export function desiredNotice(w: NoticeWallet): NoticeState {
  const threshold = Number(w.low_balance_threshold_cents ?? 0)
  if (w.status === 'paused' || w.balance_cents <= 0) return 'paused'
  if (threshold > 0 && w.balance_cents < threshold) return 'low'
  return 'none'
}

const dbDeps: NoticeDeps = {
  async loadWallet(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partner_balances')
      .select('balance_cents, low_balance_threshold_cents, status, balance_notice_state, currency')
      .eq('partner_id', partnerId).maybeSingle()
    return (data as NoticeWallet) || null
  },
  async setNoticeState(partnerId, state) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('partner_balances').update({ balance_notice_state: state }).eq('partner_id', partnerId)
  },
  async insertNotification(partnerId, n) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('partner_notifications').insert({ partner_id: partnerId, ...n })
  },
  async emailPartner(partnerId, state, wallet) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { sendEmail, emailTemplates } = await import('@/lib/email/send')
    const { data: p } = await createAdminClient().from('partners').select('contact_email, company_name').eq('id', partnerId).maybeSingle()
    if (!p?.contact_email) return
    const url = `${process.env.PARTNER_APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''}/partner/balance`
    const name = p.company_name || 'there'
    const t = state === 'paused'
      ? emailTemplates.balancePaused(name, url)
      : emailTemplates.balanceLow(name, wallet.balance_cents, wallet.currency, url)
    await sendEmail(p.contact_email, t.subject, t.html)
  },
}

let deps: NoticeDeps = dbDeps
export function __setNoticeDepsForTests(d: NoticeDeps | null) { deps = d ?? dbDeps }

const NOTICE_COPY: Record<Exclude<NoticeState, 'none'>, { kind: string; title: string; body: string }> = {
  low: {
    kind: 'balance_low',
    title: 'Balance running low',
    body: 'Top up soon to keep your clients’ voice, messaging, and AI running without interruption.',
  },
  paused: {
    kind: 'balance_paused',
    title: 'Service paused — balance empty',
    body: 'New voice, messaging, and AI are paused for your clients. Your data is safe — top up to resume.',
  },
}

// Reconcile the partner's announced notice state with reality. Fires a bell row + email only on a
// crossing INTO 'low' or 'paused'; recovery downward updates state silently. Idempotent across cron ticks.
export async function syncBalanceNotice(partnerId: string): Promise<NoticeState | null> {
  const w = await deps.loadWallet(partnerId)
  if (!w) return null
  const desired = desiredNotice(w)
  const current = w.balance_notice_state ?? 'none'
  if (desired === current) return desired

  await deps.setNoticeState(partnerId, desired)
  // Only announce escalations (into low/paused); silent on recovery so we never nag a healthy partner.
  // Leading `desired !== 'none'` narrows desired to a NOTICE_COPY key for the whole block.
  const escalating = current === 'none' || (current === 'low' && desired === 'paused')
  if (desired !== 'none' && escalating) {
    const copy = NOTICE_COPY[desired]
    await deps.insertNotification(partnerId, { ...copy, link: '/partner/balance' })
    try { await deps.emailPartner(partnerId, desired, w) } catch { /* email is best-effort */ }
  }
  return desired
}
