'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface Settings { default_invoice_provider: string; invoice_send_by_default: boolean; default_payment_terms_days: number; default_tax_behavior: string; default_invoice_email_message: string | null }
interface Provider { id: string; name: string; connected: boolean; note?: string }

// Tenant invoice defaults (default provider, terms, tax, send-by-default). Provider connect status is read
// from the existing QuickBooks/Stripe integrations — connect them on the AI employee / integrations page.
export function CommerceInvoiceSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [save, setSave] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    Promise.all([fetch('/api/core/commerce/settings').then((r) => r.json()), fetch('/api/core/commerce/invoice-providers').then((r) => r.json())])
      .then(([a, b]) => { setS(a.settings); setProviders(b.providers ?? []) }).catch(() => setS(null))
  }, [])

  async function put(patch: Record<string, unknown>) {
    setSave('saving')
    const res = await fetch('/api/core/commerce/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) { setSave('saved'); setTimeout(() => setSave((x) => (x === 'saved' ? 'idle' : x)), 1500) } else { setSave('idle'); toast.error('Could not save.') }
  }
  const set = (k: keyof Settings) => (v: unknown) => { setS((x) => (x ? { ...x, [k]: v } : x)); put({ [k]: v }) }

  if (!s) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-medium text-ink">Invoicing</h2><p className="text-xs text-muted">Defaults used when you convert a proposal to an invoice.</p></div>
        {save === 'saving' ? <span className="inline-flex items-center gap-1 text-xs text-subtle"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span> : save === 'saved' ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3 w-3" /> Saved</span> : null}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Default invoice provider</Label>
        <select value={s.default_invoice_provider} onChange={(e) => set('default_invoice_provider')(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none">
          {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.connected}>{p.name}{!p.connected ? ' (not connected)' : ''}</option>)}
        </select>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {providers.map((p) => <span key={p.id} className={`rounded-full px-2 py-0.5 ${p.connected ? 'bg-green-100 text-green-700' : 'bg-sunken text-muted'}`}>{p.name}: {p.connected ? 'connected' : 'not connected'}</span>)}
        </div>
        <p className="text-[11px] text-muted">Stripe attaches a payment link (Checkout) — not a full Stripe invoice.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label className="text-xs">Default payment terms (days)</Label><Input type="number" min="0" max="365" defaultValue={s.default_payment_terms_days} onBlur={(e) => set('default_payment_terms_days')(Number(e.target.value) || 0)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Default tax behavior</Label><select defaultValue={s.default_tax_behavior} onChange={(e) => set('default_tax_behavior')(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="none">None</option><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" defaultChecked={s.invoice_send_by_default} onChange={(e) => set('invoice_send_by_default')(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Send invoices by default (where the provider supports it)</label>
      <div className="space-y-1.5"><Label className="text-xs">Default invoice email message</Label><Textarea defaultValue={s.default_invoice_email_message ?? ''} rows={2} maxLength={4000} onBlur={(e) => set('default_invoice_email_message')(e.target.value.trim() || null)} /></div>
    </div>
  )
}
