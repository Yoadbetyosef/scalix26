'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Check } from 'lucide-react'
import { useConfirm } from '@/components/v2/confirm'

// EVERY LINK THIS ORDER HAS PUT IN SOMEBODY ELSE'S HANDS, AND THE ONE BUTTON THAT ENDS ONE.
//
// ── WHY THIS PANEL HAD TO EXIST BEFORE THE EXPIRY COULD BE REMOVED ──────────────────────────────
//
// The two link types were exactly the wrong way round. An approval link expired on its own — often
// before the recipient had opened it — while a shared estimate could never be withdrawn at all:
// `order_document_shares.revoked_at` had been on the table since the day it was created and no code
// in the repository ever wrote it. There was no route and no button.
//
// So "the link stays live until she revokes it" was not a rule that could be stated yet. Taking the
// expiry away without giving her this panel would have replaced a link that died too early with one
// that could not be killed at all, which is worse: the first is an inconvenience, the second is a
// price list she cannot take back.
//
// ── IT SHOWS WHO, AND IT CANNOT SHOW THE LINK ───────────────────────────────────────────────────
//
// Only the SHA-256 of a token is stored, so no screen can ever re-display a link that has been sent.
// That is not a limitation to work around — it is the property that makes the token safe to email.
// What she needs in order to decide is who received it and when, and those are both here.

interface ShareRow {
  id: string; docType: string; recipientName: string | null; recipientEmail: string
  sentAt: string | null; revokedAt: string | null; createdAt: string
}
interface ApprovalRow {
  id: string; approvalType: string; recipientName: string | null; recipientEmail: string
  status: string; sentAt: string | null; createdAt: string
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

/** A link the recipient can still open. Everything else is history. */
const approvalLive = (a: ApprovalRow) => !['revoked', 'draft', 'expired'].includes(a.status)

export function SharedLinks({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [shares, setShares] = useState<ShareRow[] | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()

  // Bumped after a revoke to re-run the effect below, so there is ONE place that fetches and one
  // place that sets state from it. The earlier shape called a setState-ing helper straight out of the
  // effect body, which is the cascading-render pattern react-hooks/set-state-in-effect exists to
  // catch — and it could also write into a component that had already unmounted.
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, a] = await Promise.all([
        fetch(`/api/orders/${orderId}/shares`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/orders/${orderId}/approvals`).then((r) => r.json()).catch(() => ({})),
      ])
      if (!alive) return
      setShares(s.shares ?? [])
      setApprovals(a.approvals ?? [])
    })()
    return () => { alive = false }
  }, [orderId, reload])

  const revoke = async (kind: 'share' | 'approval', id: string, who: string) => {
    if (!(await ask({
      title: 'Withdraw this link?',
      // Says what it does to the PERSON, because that is the consequence she is weighing. The order
      // is untouched and can be shared again; what changes is that the copy they were sent stops
      // opening, with a page that tells them it was withdrawn rather than that it is broken.
      body: `${who} will no longer be able to open the copy they were sent. They will see a note saying the link was withdrawn, not an error. Nothing on the order changes, and you can send a new link at any time.`,
      confirmLabel: 'Withdraw the link', danger: true,
    }))) return
    setBusy(id); setErr(null)
    try {
      const url = kind === 'share' ? `/api/orders/${orderId}/shares/${id}` : `/api/orders/${orderId}/approvals/${id}`
      const r = await fetch(url, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not withdraw the link.')
      setReload((n) => n + 1)
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const rows = [
    ...(shares ?? []).map((s) => ({
      key: `s:${s.id}`, id: s.id, kind: 'share' as const,
      label: `${title(s.docType)} link`,
      who: s.recipientName || s.recipientEmail,
      email: s.recipientEmail,
      sent: s.sentAt ?? s.createdAt,
      live: !s.revokedAt,
      note: s.revokedAt ? `Withdrawn ${when(s.revokedAt)}` : null,
    })),
    ...(approvals ?? []).map((a) => ({
      key: `a:${a.id}`, id: a.id, kind: 'approval' as const,
      label: `${title(a.approvalType)} approval`,
      who: a.recipientName || a.recipientEmail,
      email: a.recipientEmail,
      sent: a.sentAt ?? a.createdAt,
      live: approvalLive(a),
      note: approvalLive(a) ? null : title(a.status),
    })),
  ].sort((x, y) => (y.sent ?? '').localeCompare(x.sent ?? ''))

  // Nothing has ever been sent. No empty state — an empty panel on an order nobody has shared is
  // chrome explaining its own absence.
  if (shares !== null && approvals !== null && rows.length === 0) return null

  return (
    <div className="v2-card">
      <div>
        <p style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--v2-ink)' }}>Links you have sent</p>
        <span>
          These stay open for as long as you leave them open — there is no expiry. Withdrawing one is
          the only thing that closes it.
        </span>
      </div>

      {shares === null || approvals === null
        ? <p className="v2-kick" style={{ padding: '10px 0' }}>Loading…</p>
        : (
          <div className="v2-list">
            {rows.map((r) => (
              <div key={r.key} className="v2-row" style={{ ['--chan' as string]: r.live ? 'var(--v2-t2)' : 'var(--v2-t5)', padding: '11px 13px' }}>
                <div className="v2-m">
                  <p className="truncate">
                    {r.label} · {r.who}
                  </p>
                  <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11 }}>
                    {r.who !== r.email ? `${r.email} · ` : ''}
                    {when(r.sent) ?? 'not sent'}
                    {r.note ? ` · ${r.note}` : ''}
                  </span>
                </div>
                {r.live
                  ? (
                    <button onClick={() => revoke(r.kind, r.id, r.who)} disabled={busy !== null} className="v2-act" data-danger>
                      <Link2 className="h-3.5 w-3.5" />
                      {busy === r.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  )
                  : <span className="v2-kick" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check className="h-3 w-3" />Closed</span>}
              </div>
            ))}
          </div>
        )}

      {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><p>{err}</p></div>}
      {dialog}
    </div>
  )
}
