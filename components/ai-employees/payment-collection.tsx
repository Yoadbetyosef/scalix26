'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { GlassToggle } from '@/app/(v2)/v2/controls'
import { channelHue } from '@/app/(v2)/v2/channels'
import { CreditCard, Lock, X } from 'lucide-react'

interface Settings {
  require_approval: boolean
  allow_custom_amount: boolean
  allow_products: boolean
  deposit_type: 'none' | 'fixed' | 'percent'
  deposit_value: number
  channels: { sms: boolean; email: boolean; whatsapp: boolean }
}
interface PayRequest {
  id: string; status: string; kind: string; product_name: string | null; amount: number | null; currency: string
  customer_email: string | null; customer_phone: string | null; channel: string | null; created_at: string
}

const money = (a: number | null, c = 'usd') => (a == null ? 'product price' : `$${(a / 100).toFixed(2)}${c !== 'usd' ? ' ' + c.toUpperCase() : ''}`)

export function PaymentCollection({ agentId }: { agentId: string }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [active, setActive] = useState(false)
  const [s, setS] = useState<Settings | null>(null)
  const [pending, setPending] = useState<PayRequest[]>([])
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let on = true
    fetch('/api/stripe/connect/status').then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d) => on && setConnected(!!d.connected)).catch(() => on && setConnected(false))
    fetch(`/api/agents/${agentId}/payment-collection`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (on && d) { setS(d.settings); setActive(!!d.active) } }).catch(() => {})
    fetch(`/api/agents/${agentId}/payment-requests?status=pending`).then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => on && setPending(d.requests || [])).catch(() => {})
    return () => { on = false }
  }, [agentId])

  async function toggleSkill() {
    const next = !active
    setActive(next)
    try {
      const r = await fetch(`/api/agents/${agentId}/skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'payment_collection', active: next }),
      })
      if (!r.ok) throw new Error()
    } catch { setActive(!next); toast.error('Could not update') }
  }

  async function saveSettings() {
    if (!s) return
    setSaving(true)
    try {
      const r = await fetch(`/api/agents/${agentId}/payment-collection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }),
      })
      if (!r.ok) throw new Error()
      toast.success('Payment settings saved')
    } catch { toast.error('Could not save') } finally { setSaving(false) }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id)
    try {
      const r = await fetch(`/api/payment-requests/${id}/${action}`, { method: 'POST' })
      if (!r.ok) throw new Error()
      toast.success(action === 'approve' ? 'Payment link sent' : 'Request rejected')
      setPending((p) => p.filter((x) => x.id !== id))
    } catch { toast.error('Could not update request') } finally { setBusy(null) }
  }

  const upd = (patch: Partial<Settings>) => setS((v) => (v ? { ...v, ...patch } : v))
  const updCh = (patch: Partial<Settings['channels']>) => setS((v) => (v ? { ...v, channels: { ...v.channels, ...patch } } : v))

  // Locked until Stripe Connect is connected.
  if (connected === false) {
    return (
      <div style={{ marginTop: 18 }}>
        <div className="v2-grow" data-static>
          <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-mute)' }}><CreditCard /></span>
          <span className="v2-glab">
            <b style={{ fontWeight: 550 }}>Payment collection</b>
            <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
              Let the AI send customers secure Stripe payment links. Connect Stripe first — it is in
              the Appointment availability section — to switch this on.
            </span>
          </span>
          <span className="v2-gtrail">
            <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}><Lock className="w-3 h-3" /> Locked</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t2)', marginTop: 10 }}><CreditCard /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GlassToggle
            label="Payment collection"
            hint="Creates and sends secure Stripe payment links to customers."
            checked={active}
            onChange={toggleSkill}
          />
        </div>
      </div>

      {active && s && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--v2-line)' }}>
          <GlassToggle
            label="Require owner approval before sending"
            hint="Recommended — you approve each link before it goes out."
            checked={s.require_approval}
            onChange={(v) => upd({ require_approval: v })}
          />
          <GlassToggle label="Allow predefined Stripe products" checked={s.allow_products} onChange={(v) => upd({ allow_products: v })} />
          <GlassToggle label="Allow a custom amount" checked={s.allow_custom_amount} onChange={(v) => upd({ allow_custom_amount: v })} />

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 6 }}>
            <div className="v2-fld" style={{ width: 160 }}>
              <label htmlFor="pc-dtype">Deposit</label>
              <span className="v2-sel">
                <select id="pc-dtype" value={s.deposit_type} onChange={(e) => upd({ deposit_type: e.target.value as Settings['deposit_type'] })}>
                  <option value="none">None</option>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed</option>
                </select>
              </span>
            </div>
            {s.deposit_type !== 'none' && (
              <div className="v2-fld" style={{ width: 110 }}>
                <label htmlFor="pc-dval">{s.deposit_type === 'percent' ? 'Percent' : 'Amount'}</label>
                <input id="pc-dval" type="number" min={0} value={s.deposit_value ?? 0} onChange={(e) => upd({ deposit_value: Number(e.target.value) })} />
              </div>
            )}
          </div>

          <p className="v2-kick" style={{ marginTop: 20, marginBottom: 8 }}>Channels allowed</p>
          <div className="flex flex-wrap gap-2">
            {(['sms', 'email', 'whatsapp'] as const).map((c) => (
              <button key={c} type="button" onClick={() => updCh({ [c]: !s.channels[c] })} className="v2-chip" data-on={s.channels[c] || undefined}>
                <i className="v2-gdot" style={{ ['--ghue' as string]: channelHue(c) }} />
                {c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WhatsApp' : 'Email'}
              </button>
            ))}
          </div>

          <div className="v2-bar" style={{ marginTop: 18 }}>
            <button onClick={saveSettings} disabled={saving} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
              {saving ? 'Saving…' : 'Save payment settings'}
            </button>
          </div>
        </div>
      )}

      {active && pending.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--v2-line)' }}>
          <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-amber)' }}><i />Pending your approval · {pending.length}</p>
          <div className="v2-list">
            {pending.map((p) => (
              <div key={p.id} className="v2-row" style={{ ['--chan' as string]: 'var(--v2-amber)' }}>
                <div className="v2-m">
                  <p><span className="truncate">{p.product_name || 'Payment'}</span><span className="v2-stat">{money(p.amount, p.currency)}</span></p>
                  <span>{p.customer_email || p.customer_phone || 'customer'}{p.channel ? ` · ${p.channel}` : ''}</span>
                </div>
                <div className="flex items-center gap-1 flex-none">
                  <button onClick={() => decide(p.id, 'reject')} disabled={busy === p.id} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} aria-label="Reject this payment request"><X /></button>
                  <button onClick={() => decide(p.id, 'approve')} disabled={busy === p.id} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
                    {busy === p.id ? 'Sending…' : 'Approve & send'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
