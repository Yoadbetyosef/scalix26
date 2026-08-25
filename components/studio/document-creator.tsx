'use client'

import { useState } from 'react'
import { X, Settings2, Mail, MessageSquare, Copy, ExternalLink, Check, Minus, Plus } from 'lucide-react'
import type { StudioProduct, StudioVariant, StudioDocType, StudioDocument } from '@/lib/studio/types'
import { DOC_META, variantPrice, variantTitle } from '@/lib/studio/types'
import { DocSettingsModal } from '@/components/studio/doc-settings-modal'
import { Modal } from '@/components/v2/modal'

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
    <>
      {/* THE APPROVED DIALOG. This was a hand-rolled fixed overlay: no focus trap, no Escape, no
          scroll lock, no dialog role, and Tab walked straight out of it onto the page behind. The
          component does all four, and portals to <body> so an animated ancestor cannot stop it being
          fixed to the viewport. Not dismissable while a request is in flight. */}
      <Modal
        open
        onClose={onClose}
        title={doc ? `${meta.title} ready` : `New ${meta.noun}`}
        dismissable={!busy}
        wide={!!doc}
        actions={doc ? undefined : (
          <>
            <span className="v2-kick" style={{ marginRight: 'auto' }}>
              {!isProduction ? `Subtotal $${subtotal.toLocaleString()}` : `${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
            </span>
            <button onClick={() => setSettingsOpen(true)} className="v2-act tap-target"><Settings2 className="w-3.5 h-3.5" /> Branding</button>
            <button onClick={create} disabled={busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>{busy ? 'Creating…' : 'Create & preview'}</button>
          </>
        )}
      >
        {err && (
          <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)', marginBottom: 18 }}>
            <span className="v2-chip-sq"><X /></span>
            <p>{err}</p>
          </div>
        )}

        {doc ? (
          <PreviewAndSend doc={doc} meta={meta} initialEmail={email} initialPhone={phone} onClose={onClose} />
        ) : (
          <>
            {/* Items + quantities */}
            <p className="v2-kick" style={{ marginBottom: 6 }}>Items &amp; quantities</p>
            <div className="v2-list" style={{ marginBottom: 22 }}>
              {lines.map((l) => (
                <div key={l.ref} className="v2-row" style={{ ['--chan' as string]: l.qty > 0 ? 'var(--v2-t2)' : 'var(--v2-mute)' }}>
                  <div className="v2-m">
                    <p><span className="truncate">{l.name}</span></p>
                    <span>{[l.sub, !isProduction ? money(l.unit) : null].filter(Boolean).join(' · ')}</span>
                  </div>
                  {/* A stepper, in the kit's own controls: two icon buttons and the bare field the
                      form language already uses. v1 drew three bordered boxes in a row. */}
                  <div className="flex items-center gap-1 flex-none">
                    <button onClick={() => setQty(l.ref, l.qty - 1)} className="v2-ico" aria-label={`One fewer ${l.name}`}><Minus /></button>
                    <input
                      className="v2-qty" type="number" min={0} value={l.qty}
                      aria-label={`Quantity of ${l.name}`}
                      onChange={(e) => setQty(l.ref, Math.trunc(Number(e.target.value)))}
                    />
                    <button onClick={() => setQty(l.ref, l.qty + 1)} className="v2-ico" aria-label={`One more ${l.name}`}><Plus /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="v2-form">
              <div className="v2-fld wide">
                <label htmlFor="dc-party">{meta.party} name</label>
                <input id="dc-party" value={party} onChange={(e) => setParty(e.target.value)} placeholder={isProduction ? 'Factory / supplier' : 'Client name'} />
              </div>
              <div className="v2-fld">
                <label htmlFor="dc-email">{meta.party} email</label>
                <input id="dc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
              </div>
              <div className="v2-fld">
                <label htmlFor="dc-phone">{meta.party} phone</label>
                <input id="dc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
              </div>
              <div className="v2-fld wide">
                <label htmlFor="dc-notes">Notes (optional)</label>
                <textarea id="dc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </>
        )}
      </Modal>

      {settingsOpen && <DocSettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
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
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Live preview of exactly what the client sees. The frame is the media block's — one hairline,
          the card radius — because that is what a framed representation of the thing looks like here. */}
      <div>
        <p className="v2-kick" style={{ marginBottom: 8 }}>Preview — what the {meta.party.toLowerCase()} sees</p>
        <iframe src={`/d/${doc.token}`} title="Preview" style={{ height: 360, width: '100%', background: '#fff', border: '1px solid var(--v2-line)', borderRadius: 'var(--v2-radius-card)' }} />
      </div>

      {status && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
          <span className="v2-chip-sq"><Check /></span>
          <p>{status}</p>
        </div>
      )}
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
          <span className="v2-chip-sq"><X /></span>
          <p>{err}</p>
        </div>
      )}

      {/* Send */}
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="ps-email">Client email</label>
            <input id="ps-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
          </div>
          <button onClick={() => send('email')} disabled={busy === 'email'} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)', marginBottom: 4 }}><Mail className="w-3.5 h-3.5" /> {busy === 'email' ? '…' : 'Email'}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="ps-phone">Client phone</label>
            <input id="ps-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
          </div>
          <button onClick={() => send('sms')} disabled={busy === 'sms'} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)', marginBottom: 4 }}><MessageSquare className="w-3.5 h-3.5" /> {busy === 'sms' ? '…' : 'SMS'}</button>
        </div>
      </div>

      <div className="v2-bar" style={{ paddingTop: 16, borderTop: '1px solid var(--v2-line)' }}>
        <button onClick={copy} className="v2-act tap-target">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}</button>
        <a href={`/d/${doc.token}`} target="_blank" rel="noreferrer" className="v2-act tap-target"><ExternalLink className="w-3.5 h-3.5" /> Open</a>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} className="v2-act tap-target" data-solid>Done</button>
      </div>
    </div>
  )
}
