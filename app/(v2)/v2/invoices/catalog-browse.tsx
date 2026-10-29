'use client'

import { useMemo, useState } from 'react'

// BROWSE THE CATALOG FROM AN INVOICE.
//
// Supplier product names ("NUOVO 1,5 PL - GR") are not what an owner types when they think "the grey
// sofa", so a type-ahead alone finds nothing. This is the whole catalog as pictures: search over name,
// SKU and category, a category filter, and tap to select several. It renders INSIDE the invoice sheet
// in place of the form — a second modal on top of the first would fight over Escape and the veil.

export interface CatalogHit {
  id: string
  name: string
  sku: string | null
  price: number | null
  category: string | null
  image_url: string | null
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()

export function matches(p: CatalogHit, q: string) {
  const t = q.trim().toLowerCase()
  return !t || p.name.toLowerCase().includes(t) || norm(p.sku).includes(t) || norm(p.category).includes(t)
}

export function CatalogBrowse({
  catalog, loaded, onAdd, onCancel,
}: {
  catalog: CatalogHit[]
  loaded: boolean
  onAdd: (picked: CatalogHit[]) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])

  // Categories are typed by hand on each product, so "Accent chair" and "ACCENT CHAIR" are one chip.
  const cats = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>()
    for (const p of catalog) {
      const k = norm(p.category)
      if (!k) continue
      const e = m.get(k)
      if (e) e.n++
      else m.set(k, { label: p.category!.trim(), n: 1 })
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([key, v]) => ({ key, ...v }))
  }, [catalog])

  // Pictures first: the point of this view is recognising the piece by eye.
  const shown = useMemo(() => {
    const list = catalog.filter((p) => (!cat || norm(p.category) === cat) && matches(p, q))
    return [...list.filter((p) => p.image_url), ...list.filter((p) => !p.image_url)]
  }, [catalog, cat, q])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  // In the order they were tapped, so the invoice reads the way it was built.
  const picked = sel.map((id) => catalog.find((p) => p.id === id)).filter((p): p is CatalogHit => !!p)

  return (
    <>
      <label className="v2-efield">
        <span>Choose from the catalog</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU or category" autoFocus />
      </label>

      {cats.length > 0 && (
        <div className="v2-cb-cats">
          <button type="button" data-on={cat === null || undefined} onClick={() => setCat(null)}>All {catalog.length}</button>
          {cats.map((c) => (
            <button key={c.key} type="button" data-on={cat === c.key || undefined} onClick={() => setCat(cat === c.key ? null : c.key)}>
              {c.label} {c.n}
            </button>
          ))}
        </div>
      )}

      {!loaded ? (
        <p className="v2-ehint">Loading the catalog…</p>
      ) : shown.length === 0 ? (
        <p className="v2-ehint">{catalog.length ? 'Nothing matches that.' : 'The catalog is empty.'}</p>
      ) : (
        <div className="v2-cb-grid">
          {shown.map((p) => {
            const on = sel.includes(p.id)
            return (
              <button key={p.id} type="button" className="v2-cb-card" data-on={on || undefined} onClick={() => toggle(p.id)} aria-pressed={on}>
                <span className="v2-cb-img">
                  {p.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image_url} alt="" loading="lazy" />
                    : <i>{p.name.slice(0, 1)}</i>}
                  {on && <em>✓</em>}
                </span>
                <b>{p.name}</b>
                <span className="v2-cb-meta">{[p.sku, p.price != null ? money(p.price) : 'No price'].filter(Boolean).join(' · ')}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="v2-eacts v2-cb-acts">
        <button type="button" className="v2-esec" onClick={onCancel}>Back</button>
        <button type="button" className="v2-epri" onClick={() => onAdd(picked)} disabled={!picked.length}>
          {picked.length ? `Add ${picked.length} to the invoice` : 'Tap the pieces you sold'}
        </button>
      </div>
    </>
  )
}
