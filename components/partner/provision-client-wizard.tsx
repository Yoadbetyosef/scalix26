'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { money } from '@/components/partner/ui'
import { effectiveItemPricing, type PriceBook } from '@/lib/partner/wholesale'
import { X, Loader2, Rocket, Phone, MessageCircle, Share2, Camera, Globe } from 'lucide-react'

const inp = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const lbl = 'mb-1 block text-xs font-medium text-subtle'
const CHANNELS: { k: string; label: string; icon: typeof Phone }[] = [
  { k: 'phone', label: 'Phone Number', icon: Phone }, { k: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { k: 'facebook', label: 'Facebook', icon: Share2 }, { k: 'instagram', label: 'Instagram', icon: Camera },
  { k: 'google', label: 'Google Business', icon: Globe },
]

export function ProvisionClientWizard({ book, discount, markup, onClose, onCreated }: { book: PriceBook | null | undefined; discount: number | null; markup: number | null; onClose: () => void; onCreated: (created?: { tenant_id: string; business_name: string; phone_number?: string | null }) => void }) {
  const [f, setF] = useState({ business_name: '', owner_name: '', owner_email: '', owner_phone: '', website: '', plan_code: '', retail: '' })
  const [channels, setChannels] = useState<Record<string, boolean>>({ phone: true })
  const [saving, setSaving] = useState(false)

  function pickPlan(code: string) {
    setF((v) => ({ ...v, plan_code: code }))
    const it = book?.items.find((x) => x.plan_code === code)
    if (it) { const p = effectiveItemPricing(it, { customWholesaleDiscountPct: discount, retailMarkupPct: markup }); setF((v) => ({ ...v, retail: String(p.retail_cents / 100) })) }
  }
  const selItem = book?.items.find((x) => x.plan_code === f.plan_code)
  const pricing = selItem ? effectiveItemPricing(selItem, { customWholesaleDiscountPct: discount, retailMarkupPct: markup }) : null

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!f.business_name.trim()) return toast.error('Business name is required')
    setSaving(true)
    const r = await fetch('/api/partner/provision-client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      business_name: f.business_name.trim(), owner_name: f.owner_name, owner_email: f.owner_email, owner_phone: f.owner_phone,
      website: f.website, plan_code: f.plan_code || null, retail_price_cents: f.retail ? Math.round(Number(f.retail) * 100) : undefined,
      channels,
    }) })
    const j = await r.json().catch(() => ({})); setSaving(false)
    if (!r.ok) return toast.error(j.error || "Couldn't create the business")
    onCreated({ tenant_id: j.tenant_id, business_name: f.business_name.trim(), phone_number: j.phone_number })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5"><div className="font-semibold text-ink">New business</div><button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button></div>
        <form className="space-y-4 overflow-y-auto p-5" onSubmit={create}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className={lbl}>Business name</label><input className={inp} value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} placeholder="e.g. Bright Locksmiths" /></div>
            <div><label className={lbl}>Owner name</label><input className={inp} value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></div>
            <div><label className={lbl}>Owner phone</label><input className={inp} value={f.owner_phone} onChange={(e) => setF({ ...f, owner_phone: e.target.value })} placeholder="+1…" /></div>
            <div><label className={lbl}>Owner email</label><input className={inp} value={f.owner_email} onChange={(e) => setF({ ...f, owner_email: e.target.value })} /></div>
            <div><label className={lbl}>Website</label><input className={inp} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Plan</label>
              <select className={inp} value={f.plan_code} onChange={(e) => pickPlan(e.target.value)}>
                <option value="">Select a plan</option>{(book?.items || []).map((it) => <option key={it.id} value={it.plan_code}>{it.plan_name}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Price ($/mo)</label><input className={inp} inputMode="decimal" value={f.retail} onChange={(e) => setF({ ...f, retail: e.target.value })} placeholder="What this business pays" /></div>
          </div>
          {pricing && <div className="rounded-lg border border-hairline bg-canvas p-2.5 text-xs text-subtle">Price <span className="font-medium text-ink">{f.retail ? money(Math.round(Number(f.retail) * 100)) : money(pricing.retail_cents)}/mo</span> · You keep <span className="font-medium text-green-700">{money((f.retail ? Math.round(Number(f.retail) * 100) : pricing.retail_cents) - pricing.wholesale_cents)}/mo</span></div>}

          <div>
            <label className={lbl}>Channels</label>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <button type="button" key={c.k} onClick={() => setChannels((v) => ({ ...v, [c.k]: !v[c.k] }))} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${channels[c.k] ? 'border-accent bg-accent/10 text-accent-strong' : 'border-hairline-strong text-subtle hover:text-ink'}`}><c.icon className="h-3.5 w-3.5" />{c.label}</button>
              ))}
            </div>
            {channels.phone && <p className="mt-1.5 text-[11px] text-muted">A phone number will be provisioned from your connected Twilio account (if connected).</p>}
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Create business</button>
          </div>
        </form>
      </div>
    </div>
  )
}
