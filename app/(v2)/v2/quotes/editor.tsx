'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Quote } from '@/lib/core/quotes'
import { Sheet } from '../form-sheet'
import { ContactPick, createContactFor, type PickedContact } from '../contact-pick'
import { CatalogBrowse, type CatalogHit } from '../invoices/catalog-browse'
import { Doc, Plus, Send, Trash, Check } from '../invoices/glyphs'

// THE QUOTE, WHOLE, ON ONE SCREEN. The same screen makes a new one and edits an existing one — sent
// or not — because revising an offer is the ordinary thing to do with it. Only acceptance fixes it.
//
// Nothing is written until Save or Send: the editor holds the whole quote and sends the whole quote
// (PUT /api/core/quotes/[id]), so a half-edited line can never be the customer's copy.

interface Line { key: number; name: string; detail: string; imageUrl: string | null; productId: string | null; quantity: string; unitPrice: string }
const cents = (v: string) => Math.round((Number(String(v).replace(/[^0-9.]/g, '')) || 0) * 100)
const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

export function QuoteEditor({ quote }: { quote: Quote | null }) {
  const router = useRouter()
  const fixed = quote?.state === 'accepted'
  const [id, setId] = useState<string | null>(quote?.id ?? null)
  const [picked, setPicked] = useState<PickedContact | null>(quote?.contact ?? null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '')
  const [notes, setNotes] = useState(quote?.notes ?? '')
  const [discount, setDiscount] = useState(quote?.discountPercent ? plain(quote.discountPercent) : '')
  const nextKey = useRef((quote?.lines.length ?? 0) + 1)
  const [lines, setLines] = useState<Line[]>(() => (quote?.lines ?? []).map((l, i) => ({
    key: i + 1, name: l.name, detail: l.detail ?? '', imageUrl: l.imageUrl, productId: l.productId,
    quantity: plain(l.quantity), unitPrice: plain(l.unitPriceCents / 100),
  })))
  const [dirty, setDirty] = useState(!quote)
  const [busy, setBusy] = useState<null | 'save' | 'send' | 'invoice' | 'photo'>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [catalog, setCatalog] = useState<CatalogHit[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoFor = useRef<number | null>(null)

  const touch = () => { setDirty(true); setMsg(null) }
  const patch = (key: number, p: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l))); touch() }

  useEffect(() => {
    if (!browsing || catalogLoaded) return
    let off = false
    fetch('/api/catalog/products').then((r) => (r.ok ? r.json() : { products: [] })).then((j) => {
      if (off) return
      type Row = CatalogHit & { archived_at?: string | null; deleted_at?: string | null }
      setCatalog(((j.products ?? []) as Row[]).filter((p) => !p.archived_at && !p.deleted_at)
        .map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price, category: p.category, image_url: p.image_url })))
      setCatalogLoaded(true)
    }).catch(() => setCatalogLoaded(true))
    return () => { off = true }
  }, [browsing, catalogLoaded])

  function addFromCatalog(hits: CatalogHit[]) {
    setLines((ls) => [...ls, ...hits.map((p) => ({
      key: nextKey.current++, name: p.name, detail: p.sku ? `Ref. ${p.sku}` : '', imageUrl: p.image_url, productId: p.id,
      quantity: '1', unitPrice: p.price != null ? String(p.price) : '',
    }))])
    setBrowsing(false); touch()
  }
  const addBlank = () => { setLines((ls) => [...ls, { key: nextKey.current++, name: '', detail: '', imageUrl: null, productId: null, quantity: '1', unitPrice: '' }]); touch() }

  async function onPhoto(file: File) {
    const key = photoFor.current
    if (key === null) return
    setBusy('photo'); setMsg(null)
    try {
      const body = new FormData(); body.append('file', file)
      const res = await fetch('/api/catalog/upload', { method: 'POST', body })
      const j = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !j.url) setMsg({ text: j.error || 'That photo could not be uploaded.', bad: true })
      else patch(key, { imageUrl: j.url })
    } catch { setMsg({ text: 'That photo could not be uploaded — check your connection.', bad: true }) } finally { setBusy(null) }
  }

  const usable = lines.filter((l) => l.name.trim())
  const subtotal = usable.reduce((s, l) => s + Math.round(num(l.quantity) * cents(l.unitPrice)), 0)
  const pct = Math.min(100, Math.max(0, num(discount)))
  const off = Math.round((subtotal * pct) / 100)
  const total = subtotal - off

  /** Save the whole quote. Returns its id, or null when something stopped it (and says what). */
  async function save(): Promise<string | null> {
    let contactId = picked?.id ?? null
    if (!contactId && (name.trim() || email.trim() || phone.trim())) {
      const r = await createContactFor({ name, email, phone })
      const c = r.duplicateOf ?? (r.ok ? r.contact : undefined)
      if (!c) { setMsg({ text: r.error || 'That customer could not be saved.', bad: true }); return null }
      contactId = c.id; setPicked(c)
    }
    const body = JSON.stringify({
      contactId, validUntil: validUntil || null, notes: notes.trim() || null, discountPercent: pct || null,
      lines: usable.map((l) => ({ name: l.name.trim(), detail: l.detail.trim() || null, imageUrl: l.imageUrl, productId: l.productId, quantity: num(l.quantity), unitPriceCents: cents(l.unitPrice) })),
    })
    try {
      const res = await fetch(id ? `/api/core/quotes/${id}` : '/api/core/quotes', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; id?: string; error?: string }
      if (!res.ok || !j.ok || !j.id) { setMsg({ text: j.error || 'The quote could not be saved.', bad: true }); return null }
      setDirty(false)
      if (!id) { setId(j.id); window.history.replaceState(null, '', `/v2/quotes/${j.id}`) }
      return j.id
    } catch { setMsg({ text: 'The quote could not be saved — check your connection.', bad: true }); return null }
  }

  async function onSave() {
    if (busy) return
    setBusy('save')
    const saved = await save()
    if (saved) { setMsg({ text: 'Saved.' }); router.refresh() }
    setBusy(null)
  }
  async function onSend() {
    if (busy) return
    if (!usable.length || total <= 0) { setMsg({ text: 'Add at least one item with a price before sending.', bad: true }); return }
    setBusy('send')
    const saved = await save()
    if (saved) {
      try {
        const res = await fetch(`/api/core/quotes/${saved}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; to?: string; channel?: string; error?: string }
        if (!res.ok || !j.ok) setMsg({ text: j.error || 'The quote was saved but could not be sent.', bad: true })
        else { setMsg({ text: `Sent by ${j.channel === 'sms' ? 'text' : 'email'} to ${j.to}.` }); router.refresh() }
      } catch { setMsg({ text: 'The quote was saved but could not be sent — check your connection.', bad: true }) }
    }
    setBusy(null)
  }
  async function onInvoice() {
    if (busy || !id) return
    setBusy('invoice')
    try {
      const res = await fetch(`/api/core/quotes/${id}/invoice`, { method: 'POST' })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; invoiceId?: string; error?: string }
      if (!res.ok || !j.ok || !j.invoiceId) { setMsg({ text: j.error || 'The invoice could not be made.', bad: true }); setBusy(null); return }
      router.push(`/v2/invoices/${j.invoiceId}`)
    } catch { setMsg({ text: 'The invoice could not be made — check your connection.', bad: true }); setBusy(null) }
  }

  const sentLine = quote?.state === 'accepted' ? 'The customer accepted this quote. It is fixed — make the invoice from it.'
    : quote?.sentAt ? 'Already sent. You can still change it and send it again — the customer\'s link shows the latest saved version.'
      : 'Send emails the customer a link to their copy. They can accept it in one tap.'

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href="/v2/quotes" className="v2-bk" aria-label="Quotes">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <h2>{quote ? quote.number : 'New quote'}</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          <p className="v2-ag-grp"><span className="v2-ag-gt">WHO IT IS FOR</span><span className="v2-ag-gr" /></p>
          <div className="v2-qt-who">
            <div>
              <ContactPick picked={picked} onPick={(c) => { setPicked(c); if (!c) { setName(''); setEmail(''); setPhone('') } touch() }} disabled={!!busy || fixed} />
              {!picked && !fixed && (
                <div className="v2-qt-new">
                  <label className="v2-efield"><span>Name</span><input value={name} onChange={(e) => { setName(e.target.value); touch() }} /></label>
                  <label className="v2-efield"><span>Email</span><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); touch() }} /></label>
                  <label className="v2-efield"><span>Phone</span><input value={phone} onChange={(e) => { setPhone(e.target.value); touch() }} /></label>
                </div>
              )}
            </div>
            <label className="v2-efield"><span>Valid until</span><input type="date" value={validUntil} disabled={fixed} onChange={(e) => { setValidUntil(e.target.value); touch() }} /></label>
          </div>

          <p className="v2-ag-grp"><span className="v2-ag-gt">WHAT&apos;S ON IT</span><span className="v2-ag-gn">{usable.length}</span><span className="v2-ag-gr" /></p>
          <div className="v2-ag-card">
            {lines.length === 0 && <p className="v2-iv-none">Nothing on it yet. Add pieces from your catalog, or type a line.</p>}
            {lines.map((l, i) => (
              <div key={l.key}>
                {i > 0 && <div className="v2-ag-sep" />}
                <div className="v2-qt-li">
                  <button type="button" className="v2-qt-ph" disabled={fixed || busy === 'photo'} title="Change photo"
                    onClick={() => { photoFor.current = l.key; fileRef.current?.click() }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {l.imageUrl ? <img src={l.imageUrl} alt="" /> : <i />}
                    {!fixed && <span>{l.imageUrl ? 'Change photo' : 'Add photo'}</span>}
                  </button>
                  <div className="v2-qt-txt">
                    <input className="v2-qt-nm" value={l.name} placeholder="Item name" disabled={fixed} aria-label="Item name" onChange={(e) => patch(l.key, { name: e.target.value })} />
                    <input className="v2-qt-dt" value={l.detail} placeholder="Size, finish, fabric…" disabled={fixed} aria-label="Details" onChange={(e) => patch(l.key, { detail: e.target.value })} />
                  </div>
                  <input className="v2-qt-q" value={l.quantity} inputMode="decimal" disabled={fixed} aria-label="Quantity" onChange={(e) => patch(l.key, { quantity: e.target.value })} />
                  <span className="v2-qt-x">×</span>
                  <input className="v2-qt-p" value={l.unitPrice} inputMode="decimal" placeholder="Price" disabled={fixed} aria-label="Price each" onChange={(e) => patch(l.key, { unitPrice: e.target.value })} />
                  <span className="v2-qt-t">{money(Math.round(num(l.quantity) * cents(l.unitPrice)))}</span>
                  {!fixed && (
                    <button type="button" className="v2-iv-del" title="Remove this item" aria-label={`Remove ${l.name || 'this item'}`}
                      onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); touch() }}><Trash /></button>
                  )}
                </div>
              </div>
            ))}
            {!fixed && (
              <>
                <div className="v2-ag-sep" />
                <div className="v2-qt-add">
                  <button type="button" className="v2-iv-btn" onClick={() => setBrowsing(true)}><Plus />Add from catalog</button>
                  <button type="button" className="v2-iv-btn" onClick={addBlank}><Plus />Add a line</button>
                </div>
              </>
            )}
            <div className="v2-ag-sep" />
            <div className="v2-iv-tot"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="v2-iv-tot">
              <span className="v2-qt-disc">Discount <input value={discount} inputMode="decimal" placeholder="0" disabled={fixed} aria-label="Discount percent" onChange={(e) => { setDiscount(e.target.value); touch() }} /> %</span>
              <span>{off > 0 ? `−${money(off)}` : money(0)}</span>
            </div>
            <div className="v2-iv-tot" data-big><span>Total</span><span>{money(total)}</span></div>
          </div>

          <p className="v2-ag-grp"><span className="v2-ag-gt">A NOTE TO THE CUSTOMER</span><span className="v2-ag-gr" /></p>
          <label className="v2-efield">
            <textarea rows={3} value={notes} disabled={fixed} placeholder="Lead time, delivery, what is and is not included…" onChange={(e) => { setNotes(e.target.value); touch() }} />
          </label>

          {quote && quote.history.length > 0 && (
            <>
              <p className="v2-ag-grp"><span className="v2-ag-gt">HISTORY</span><span className="v2-ag-gr" /></p>
              <div className="v2-ag-card">
                {quote.history.map((h, i) => (
                  <div key={i}>
                    {i > 0 && <div className="v2-ag-sep" />}
                    <div className="v2-iv-prow" data-quiet>
                      <span className="v2-iv-pmid">
                        <span className="v2-iv-pm">{h.note}</span>
                        <span className="v2-iv-pd">{new Date(h.at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="v2-iv-slot">
        <div className="v2-iv-slotin">
          {id && !dirty && <a className="v2-iv-btn" href={`/v2/quotes/${id}/paper`} target="_blank" rel="noreferrer"><Doc />View as customer</a>}
          {!fixed && <button type="button" className="v2-iv-btn" disabled={!!busy || !dirty} onClick={onSave}><Check />{busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>}
          {!fixed && <button type="button" className="v2-iv-btn" data-p disabled={!!busy} onClick={onSend}><Send />{busy === 'send' ? 'Sending…' : quote?.sentAt ? 'Send again' : 'Send quote'}</button>}
          {id && !dirty && (quote?.invoiceId
            ? <Link className="v2-iv-btn" data-p={fixed ? true : undefined} href={`/v2/invoices/${quote.invoiceId}`}><Doc />Open the invoice</Link>
            : quote && quote.state !== 'draft' && <button type="button" className="v2-iv-btn" data-p={fixed ? true : undefined} disabled={!!busy} onClick={onInvoice}><Doc />{busy === 'invoice' ? 'Making it…' : 'Make invoice'}</button>)}
          <p className="v2-iv-smsg">{msg ? <b style={msg.bad ? { color: 'var(--iv-late-ink)' } : undefined}>{msg.text}</b> : sentLine}</p>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = '' }} />

      {browsing && (
        <Sheet title="Add from catalog" wide busy={false} onClose={() => setBrowsing(false)}>
          <CatalogBrowse catalog={catalog} loaded={catalogLoaded} onAdd={addFromCatalog} onCancel={() => setBrowsing(false)} />
        </Sheet>
      )}
    </div>
  )
}
