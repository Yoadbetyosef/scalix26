'use client'

import { useState } from 'react'
import { X, Settings2, Mail, MessageSquare, Copy, ExternalLink, Check } from 'lucide-react'
import type { StudioProduct, StudioVariant, StudioDocType, StudioDocument } from '@/lib/studio/types'
import { DOC_META, variantPrice, variantTitle } from '@/lib/studio/types'
import { DocSettingsModal } from '@/components/studio/doc-settings-modal'

const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const money = (n: number | null) => (n != null ? `$${Number(n).toLocaleString()}` : '—')

type Line = { ref: string; name: string; sub: string | null; unit: number | null; qty: number }

export function DocumentCreator({ product, variants, type, onClose }: {
  product: StudioProduct
  variants: StudioVariant[]
  type: StudioDocType
  onClose: () => void
}) {
  const meta = DOC_META[type]
  const isProduction = type === 'production'

  const [lines, setLines] = useState<Line[]>(() => [
    { ref: 'product', name: product.name, sub: 'Base product', unit: product.base_price, qty: variants.length ? 0 : 1 },
    ...variants.map((v) => ({
      ref: v.id, name: variantTitle(v),
      sub: v.fabric_name ? `${v.fabric_family} · ${v.fabric_name}` : null,
      unit: variantPrice(product, v), qty: 0,
    })),
  ])
  const [party, setParty] = useState(isProduction ? product.supplier_name || '' : '')
  const [email, setEmail] = useState(isProduction ? product.supplier_email || '' : '')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [doc, setDoc] = useState<StudioDocument | null>(null)

  const setQty = (ref: string, qty: number) => setLines((ls) => ls.map((l) => (l.ref === ref ? { ...l, qty: Math.max(0, qty) } : l)))
  const chosen = lines.filter((l) => l.qty > 0)
  const subtotal = chosen.reduce((s, l) => s + (l.unit || 0) * l.qty, 0)

  async function create() {
    if (chosen.length === 0) { setErr('Pick at least one item'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/studio/products/${product.id}/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, party_name: party, party_email: email, client_phone: phone, notes, items: chosen.map((l) => ({ ref: l.ref, qty: l.qty })) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      setDoc(d.document)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{doc ? `${meta.title} ready` : `New ${meta.noun}`}</h2>
          <div className="flex items-center gap-1">
            {!doc && <button onClick={() => setSettingsOpen(true)} title="Branding & terms" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-subtle hover:bg-sunken hover:text-ink"><Settings2 className="h-4 w-4" /> Branding</button>}
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {doc ? (
          <PreviewAndSend doc={doc} meta={meta} initialEmail={email} initialPhone={phone} onClose={onClose} />
        ) : (
          <>
            {/* Items + quantities */}
            <div className="mb-4 rounded-xl border border-hairline-strong">
              <p className="border-b border-hairline px-3 py-2 text-xs font-medium uppercase tracking-wide text-subtle">Items & quantities</p>
              <div className="divide-y divide-hairline">
                {lines.map((l) => (
                  <div key={l.ref} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{l.name}</p>
                      <p className="truncate text-xs text-muted">{[l.sub, !isProduction ? money(l.unit) : null].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button onClick={() => setQty(l.ref, l.qty - 1)} className="h-8 w-8 rounded-lg border border-hairline-strong text-ink">−</button>
                      <input className="h-8 w-12 rounded-lg border border-hairline-strong text-center text-sm outline-none focus:border-accent" type="number" min={0} value={l.qty} onChange={(e) => setQty(l.ref, Math.trunc(Number(e.target.value)))} />
                      <button onClick={() => setQty(l.ref, l.qty + 1)} className="h-8 w-8 rounded-lg border border-hairline-strong text-ink">+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{meta.party} name</span>
                <input className={input} value={party} onChange={(e) => setParty(e.target.value)} placeholder={isProduction ? 'Factory / supplier' : 'Client name'} />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{meta.party} email</span>
                  <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{meta.party} phone</span>
                  <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Notes (optional)</span>
                <textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-between">
              {!isProduction ? <span className="text-sm text-muted">Subtotal <span className="text-base font-bold text-ink">${subtotal.toLocaleString()}</span></span> : <span className="text-sm text-muted">{chosen.length} item{chosen.length === 1 ? '' : 's'}</span>}
              <button onClick={create} disabled={busy} className="h-11 rounded-lg bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create & preview'}</button>
            </div>
          </>
        )}
      </div>

      {settingsOpen && <DocSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function PreviewAndSend({ doc, meta, initialEmail, initialPhone, onClose }: {
  doc: StudioDocument
  meta: { title: string; party: string; noun: string }
  initialEmail: string
  initialPhone: string
  onClose: () => void
}) {
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/d/${doc.token}`
  const [email, setEmail] = useState(initialEmail)
  const [phone, setPhone] = useState(initialPhone)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'email' | 'sms'>('')
  const [copied, setCopied] = useState(false)

  async function send(channel: 'email' | 'sms') {
    const to = channel === 'email' ? email.trim() : phone.trim()
    if (!to) { setErr(`Enter a ${channel === 'email' ? 'email' : 'phone number'}`); return }
    setBusy(channel); setErr(null); setStatus(null)
    try {
      const res = await fetch(`/api/studio/documents/${doc.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, to }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Send failed')
      setStatus(`Sent by ${channel === 'email' ? 'email' : 'SMS'} ✓`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  function copy() { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="space-y-4">
      {/* Live preview of exactly what the client sees */}
      <div className="overflow-hidden rounded-xl border border-hairline-strong">
        <p className="border-b border-hairline bg-sunken/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-subtle">Preview — what the {meta.party.toLowerCase()} sees</p>
        <iframe src={`/d/${doc.token}`} title="Preview" className="h-[360px] w-full bg-white" />
      </div>

      {status && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Send */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Client email" />
          <button onClick={() => send('email')} disabled={busy === 'email'} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50"><Mail className="h-4 w-4" /> {busy === 'email' ? '…' : 'Email'}</button>
        </div>
        <div className="flex gap-2">
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Client phone" />
          <button onClick={() => send('sms')} disabled={busy === 'sms'} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50"><MessageSquare className="h-4 w-4" /> {busy === 'sms' ? '…' : 'SMS'}</button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-hairline pt-3">
        <div className="flex gap-3">
          <button onClick={copy} className="inline-flex items-center gap-1.5 text-sm font-medium text-subtle hover:text-ink">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}</button>
          <a href={`/d/${doc.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-subtle hover:text-ink"><ExternalLink className="h-4 w-4" /> Open</a>
        </div>
        <button onClick={onClose} className="h-10 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink">Done</button>
      </div>
    </div>
  )
}
