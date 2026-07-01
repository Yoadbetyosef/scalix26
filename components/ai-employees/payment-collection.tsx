'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { CreditCard, Lock, Check, X } from 'lucide-react'

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
      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Payment Collection</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600"><Lock className="h-3 w-3" /> Locked</span>
        </div>
        <p className="mt-2 text-xs text-gray-500">Let the AI send customers secure Stripe payment links. <span className="font-medium text-gray-700">Connect Stripe first</span> (in the Payments section above) to enable this skill.</p>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-hairline p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-emerald-500 text-white shadow-e1"><CreditCard className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Payment Collection</p>
          <p className="text-xs text-subtle">Creates and sends secure Stripe payment links to customers.</p>
        </div>
        <Switch checked={active} onCheckedChange={toggleSkill} className="mt-1 flex-shrink-0" />
      </div>

      {active && s && (
        <div className="mt-4 space-y-3 border-t border-hairline pt-4">
          <Row label="Require owner approval before sending" hint="Recommended — you approve each link before it goes out.">
            <Switch checked={s.require_approval} onCheckedChange={(v) => upd({ require_approval: v })} />
          </Row>
          <Row label="Allow predefined Stripe products">
            <Switch checked={s.allow_products} onCheckedChange={(v) => upd({ allow_products: v })} />
          </Row>
          <Row label="Allow custom amount">
            <Switch checked={s.allow_custom_amount} onCheckedChange={(v) => upd({ allow_custom_amount: v })} />
          </Row>
          <Row label="Deposit">
            <div className="flex items-center gap-2">
              <select value={s.deposit_type} onChange={(e) => upd({ deposit_type: e.target.value as Settings['deposit_type'] })}
                className="rounded-md border border-hairline bg-white px-2 py-1 text-xs text-ink">
                <option value="none">None</option>
                <option value="fixed">Fixed $</option>
                <option value="percent">% of price</option>
              </select>
              {s.deposit_type !== 'none' && (
                <input type="number" min={0} value={s.deposit_value} onChange={(e) => upd({ deposit_value: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-20 rounded-md border border-hairline px-2 py-1 text-xs" placeholder={s.deposit_type === 'fixed' ? '$' : '%'} />
              )}
            </div>
          </Row>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink">Channels allowed</p>
            <div className="flex flex-wrap gap-2">
              {(['sms', 'email', 'whatsapp'] as const).map((c) => (
                <button key={c} type="button" onClick={() => updCh({ [c]: !s.channels[c] })}
                  className={`rounded-full border px-3 py-1 text-xs capitalize ${s.channels[c] ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-hairline text-subtle'}`}>
                  {s.channels[c] && <Check className="mr-1 inline h-3 w-3" />}{c === 'sms' ? 'SMS' : c}
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={saveSettings} loading={saving}>Save payment settings</Button>
        </div>
      )}

      {active && pending.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <p className="mb-2 text-xs font-semibold text-ink">Pending approval ({pending.length})</p>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-hairline p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{p.product_name || 'Payment'} · {money(p.amount, p.currency)}</p>
                  <p className="truncate text-[11px] text-subtle">{p.customer_email || p.customer_phone || 'customer'}{p.channel ? ` · ${p.channel}` : ''}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => decide(p.id, 'reject')} disabled={busy === p.id}><X className="h-3.5 w-3.5" /></Button>
                <Button size="sm" onClick={() => decide(p.id, 'approve')} loading={busy === p.id}>Approve &amp; send</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{label}</p>
        {hint && <p className="text-[11px] text-subtle">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}
