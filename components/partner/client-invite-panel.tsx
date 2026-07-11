'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X, Send, RefreshCw, Link2, Ban, Loader2, CheckCircle2, Mail, Clock } from 'lucide-react'

type Invite = { email: string; first_name: string | null; last_name: string | null; phone: string | null; status: string } | null

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  none: { label: 'Not invited', cls: 'bg-sunken text-subtle' },
  draft: { label: 'Draft', cls: 'bg-sunken text-subtle' },
  sent: { label: 'Sent', cls: 'bg-blue-50 text-blue-700' },
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700' },
  accepted: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
  expired: { label: 'Expired', cls: 'bg-red-50 text-red-700' },
  revoked: { label: 'Revoked', cls: 'bg-red-50 text-red-600' },
}

// Manage the owner invitation for one business. Every action hits the partner-authenticated, audited
// API which re-validates ownership server-side. Reuses the one product — this just controls access.
export function ClientInvitePanel({ tenantId, businessName, onClose, onChanged }: {
  tenantId: string; businessName: string; onClose: () => void; onChanged?: () => void
}) {
  const [f, setF] = useState({ email: '', first_name: '', last_name: '', phone: '' })
  const [status, setStatus] = useState('none')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/partner/invites?tenant_id=${tenantId}`).then((r) => r.json()).then((j: { invite: Invite }) => {
      if (j.invite) { setF({ email: j.invite.email || '', first_name: j.invite.first_name || '', last_name: j.invite.last_name || '', phone: j.invite.phone || '' }); setStatus(j.invite.status) }
    }).finally(() => setLoading(false))
  }, [tenantId])

  async function act(action: string) {
    if ((action === 'send' || action === 'resend' || action === 'copy_link') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return toast.error('Enter a valid owner email.')
    setBusy(action)
    try {
      const r = await fetch('/api/partner/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: tenantId, action, ...f }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error || 'Action failed'); return }
      if (j.invite) setStatus(j.invite.status)
      if (action === 'copy_link' && j.link) { await navigator.clipboard.writeText(j.link).catch(() => {}); toast.success('Invite link copied') }
      else if (action === 'send') toast.success(j.emailed ? 'Invitation sent' : (j.note || 'Saved — use Copy Link'))
      else if (action === 'resend') toast.success(j.emailed ? 'Invitation resent' : (j.note || 'Saved — use Copy Link'))
      else if (action === 'revoke') toast.success('Invitation revoked')
      onChanged?.()
    } finally { setBusy(null) }
  }

  const s = STATUS_LABEL[status] || STATUS_LABEL.none
  const accepted = status === 'accepted'
  const inp = 'h-10 w-full rounded-xl border border-hairline bg-surface px-3.5 text-sm text-ink outline-none focus:border-accent/40'
  const lbl = 'mb-1 block text-xs font-medium text-subtle'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="min-w-0">
            <div className="font-semibold text-ink">Business owner access</div>
            <div className="truncate text-xs text-subtle">{businessName}</div>
          </div>
          <span className={`ml-2 flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
          <button onClick={onClose} className="ml-2 rounded-full bg-sunken p-1.5 text-subtle hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-sunken" />)}</div>
        ) : accepted ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-6 w-6" /></div>
            <div className="text-[15px] font-semibold text-ink">Owner is active</div>
            <p className="mx-auto mt-1 max-w-xs text-sm text-subtle">{f.email} has accepted and can sign in to manage {businessName}.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={lbl}>Owner email</label><input className={inp} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="owner@business.com" /></div>
              <div><label className={lbl}>First name</label><input className={inp} value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
              <div><label className={lbl}>Last name</label><input className={inp} value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Phone (optional)</label><input className={inp} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => act(status === 'none' || status === 'draft' ? 'send' : 'resend')} disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-105 disabled:opacity-60">
                {busy === 'send' || busy === 'resend' ? <Loader2 className="h-4 w-4 animate-spin" /> : (status === 'none' || status === 'draft' ? <Send className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />)}
                {status === 'none' || status === 'draft' ? 'Send invite' : 'Resend'}
              </button>
              <button onClick={() => act('copy_link')} disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-4 py-2 text-sm font-medium text-subtle transition-colors hover:text-ink disabled:opacity-60">
                {busy === 'copy_link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Copy link
              </button>
              {status !== 'none' && status !== 'revoked' && (
                <button onClick={() => act('revoke')} disabled={!!busy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-60">
                  {busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Revoke
                </button>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              {status === 'sent' ? <><Mail className="h-3 w-3" /> Invitation emailed — awaiting the owner.</>
                : status === 'pending' ? <><Clock className="h-3 w-3" /> The owner opened the invite but hasn’t finished yet.</>
                : 'The owner receives a branded email to create their password and sign in.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
