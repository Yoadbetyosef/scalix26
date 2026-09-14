'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ContactPicker, type PickedContact } from '@/components/orders/contact-picker'
import { SupplierPicker, type Supplier } from '@/components/orders/supplier-picker'
import type { MemoDirection, MemoKind } from '@/lib/memos/types'

// One form for both directions. Sending OUT asks which stock item; receiving IN asks what the
// piece is and whose it is. Either way: a price, a date, a follow-up date, a note.

interface StockItem { id: string; name: string; sku: string | null; showroom_quantity: number; warehouse_quantity: number; storage_quantity: number; ownership?: string | null }

export function MemoForm() {
  const router = useRouter()
  const [direction, setDirection] = useState<MemoDirection>('out')
  const [kind, setKind] = useState<MemoKind>('memo')
  const [stock, setStock] = useState<StockItem[]>([])
  const [q, setQ] = useState('')
  const [productId, setProductId] = useState<string>('')
  const [customer, setCustomer] = useState<PickedContact>({ id: null, name: '', company: '', email: '', phone: '', address: '', currency: 'usd' })
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [f, setF] = useState({
    itemDescription: '', quantity: '1', fromLocation: 'showroom', agreedPrice: '', cost: '',
    movedOn: new Date().toISOString().slice(0, 10), dueOn: '', notes: '', currency: 'usd',
  })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  // Stock we can send out: owned products with something in a location.
  useEffect(() => {
    if (direction !== 'out') return
    fetch('/api/catalog/products').then((r) => (r.ok ? r.json() : { products: [] })).then((j) => {
      const rows: StockItem[] = (j.products ?? j ?? []) as StockItem[]
      setStock(rows.filter((p) => (p.ownership ?? 'owned') === 'owned' && (p.showroom_quantity + p.warehouse_quantity + p.storage_quantity) > 0))
    }).catch(() => setStock([]))
  }, [direction])

  const filtered = q.trim()
    ? stock.filter((p) => [p.name, p.sku].some((v) => (v ?? '').toLowerCase().includes(q.trim().toLowerCase())))
    : stock
  const chosen = stock.find((p) => p.id === productId) ?? null

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const cents = (v: string) => (v.trim() === '' ? null : Math.round((parseFloat(v) || 0) * 100))
      const body = {
        direction, kind,
        catalogProductId: direction === 'out' ? (productId || null) : null,
        itemDescription: f.itemDescription.trim() || null,
        quantity: Math.max(1, parseInt(f.quantity, 10) || 1),
        fromLocation: f.fromLocation,
        contactId: direction === 'out' ? customer.id : null,
        supplierId: direction === 'in' ? (supplier?.id ?? null) : null,
        counterpartyName: direction === 'out' ? (customer.company || customer.name || null) : (supplier?.name ?? null),
        agreedPriceCents: cents(f.agreedPrice), costCents: cents(f.cost), currency: f.currency,
        movedOn: f.movedOn || null, dueOn: f.dueOn || null, notes: f.notes || null,
      }
      const r = await fetch('/api/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not save the memo.')
      router.push(`/orders/memos/${j.memo.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-7">
      {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><p>{err}</p></div>}

      <section>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />What is happening</p><s /></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="v2-chip" data-on={direction === 'out' || undefined} onClick={() => setDirection('out')}>Sending our piece out</button>
          <button type="button" className="v2-chip" data-on={direction === 'in' || undefined} onClick={() => setDirection('in')}>Receiving a supplier&apos;s piece</button>
          <span style={{ width: 12 }} />
          <button type="button" className="v2-chip" data-on={kind === 'memo' || undefined} onClick={() => setKind('memo')}>On memo</button>
          <button type="button" className="v2-chip" data-on={kind === 'consignment' || undefined} onClick={() => setKind('consignment')}>On consignment</button>
        </div>
        <p className="v2-hint" style={{ marginTop: 8 }}>
          {direction === 'out'
            ? 'The piece leaves stock and is unavailable until it comes back or is sold. It stays ours.'
            : 'The piece is entered as stock you can sell but do not own. Returned, it disappears from stock; sold, the memo records what is owed.'}
        </p>
      </section>

      {direction === 'out' ? (
        <section>
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />The piece</p><s /></div>
          <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor="memo-q">Find in stock</label>
              <input id="memo-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or SKU" /></div>
            <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor="memo-product">Stock item</label>
              <span className="v2-sel">
                <select id="memo-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">—</option>
                  {filtered.slice(0, 200).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''} · showroom {p.showroom_quantity} / warehouse {p.warehouse_quantity} / storage {p.storage_quantity}</option>
                  ))}
                </select>
              </span>
              {stock.length === 0 && <span className="v2-hint">Nothing in stock to send — receive stock in the catalog first.</span>}
            </div>
            <div className="v2-fld"><label htmlFor="memo-qty">Quantity</label><input id="memo-qty" value={f.quantity} onChange={set('quantity')} inputMode="numeric" /></div>
            <div className="v2-fld"><label htmlFor="memo-loc">From</label>
              <span className="v2-sel"><select id="memo-loc" value={f.fromLocation} onChange={set('fromLocation')}>
                <option value="showroom">Showroom{chosen ? ` (${chosen.showroom_quantity})` : ''}</option>
                <option value="warehouse">Warehouse{chosen ? ` (${chosen.warehouse_quantity})` : ''}</option>
                <option value="storage">Storage{chosen ? ` (${chosen.storage_quantity})` : ''}</option>
              </select></span></div>
          </div>
        </section>
      ) : (
        <section>
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />The piece</p><s /></div>
          <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor="memo-desc">Description</label>
              <input id="memo-desc" value={f.itemDescription} onChange={set('itemDescription')} placeholder="e.g. 1.52ct oval D VS1 GIA 2234…" /></div>
            <div className="v2-fld"><label htmlFor="memo-qty2">Quantity</label><input id="memo-qty2" value={f.quantity} onChange={set('quantity')} inputMode="numeric" /></div>
            <div className="v2-fld"><label htmlFor="memo-loc2">Kept in</label>
              <span className="v2-sel"><select id="memo-loc2" value={f.fromLocation} onChange={set('fromLocation')}>
                <option value="showroom">Showroom</option><option value="warehouse">Warehouse</option><option value="storage">Storage</option>
              </select></span></div>
          </div>
        </section>
      )}

      <section>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />{direction === 'out' ? 'Who has it' : 'Whose it is'}</p><s /></div>
        {direction === 'out'
          ? <ContactPicker value={customer} onChange={setCustomer} />
          : <SupplierPicker value={supplier} onChange={setSupplier} />}
      </section>

      <section>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Terms</p><s /></div>
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div className="v2-fld"><label htmlFor="memo-price">{direction === 'out' ? 'Agreed price' : 'Selling price'}</label>
            <input id="memo-price" value={f.agreedPrice} onChange={set('agreedPrice')} inputMode="decimal" placeholder="0.00" /></div>
          <div className="v2-fld"><label htmlFor="memo-cost">{direction === 'out' ? 'Our cost (internal)' : 'Owed to supplier if sold'}</label>
            <input id="memo-cost" value={f.cost} onChange={set('cost')} inputMode="decimal" placeholder="0.00" /></div>
          <div className="v2-fld"><label htmlFor="memo-cur">Currency</label>
            <span className="v2-sel"><select id="memo-cur" value={f.currency} onChange={set('currency')}>
              <option value="usd">USD</option><option value="cad">CAD</option>
            </select></span></div>
          <div className="v2-fld"><label htmlFor="memo-date">{direction === 'out' ? 'Sent on' : 'Received on'}</label>
            <input id="memo-date" type="date" value={f.movedOn} onChange={set('movedOn')} /></div>
          <div className="v2-fld"><label htmlFor="memo-due">Follow up by</label>
            <input id="memo-due" type="date" value={f.dueOn} onChange={set('dueOn')} /></div>
          <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor="memo-notes">Notes</label>
            <textarea id="memo-notes" value={f.notes} onChange={set('notes')} rows={2} /></div>
        </div>
      </section>

      <div className="v2-bar">
        <button type="button" onClick={submit} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : direction === 'out' ? 'Send on memo' : 'Record received'}</button>
      </div>
    </div>
  )
}
