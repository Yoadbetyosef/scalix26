'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Package, Upload, Download, Trash2, ListChecks, ChevronRight, AlertTriangle } from 'lucide-react'
import type { VariantsByProduct } from '@/lib/catalog/variants'
import { AVAILABILITY_LABELS, totalAvailable, type CatalogProduct, type AvailabilityStatus } from '@/lib/catalog/types'
import { ConnectWebsite } from '@/components/catalog/connect-website'
import { useConfirm } from '@/components/v2/confirm'

// The four shelf states as hues rather than four tinted rectangles — but IN STOCK GETS NO COLOUR.
// v1 painted it green, which meant every normal row in a 500-product catalogue carried a coloured
// badge and nothing on the screen stood out. In stock is the absence of a problem; the tokens say
// green is transient state only and never decorative, and this palette deliberately avoids the
// traffic-light set. So colour marks the exception — out of stock, something arriving, something
// that has to be ordered in — and the ordinary shelf is mute. The chip is .v2-stat, which takes its
// ink from --chan, so a state is one value here rather than a pair of Tailwind colour classes.
const HUE: Record<AvailabilityStatus, string> = {
  in_stock: 'var(--v2-mute)',
  out_of_stock: 'var(--v2-red)',
  incoming: 'var(--v2-amber)',
  special_order: 'var(--v2-t3)',
}
const FILTERS: { key: string; label: string; test: (p: CatalogProduct) => boolean }[] = [
  // First, because it is the only filter that describes WORK rather than a state of the shelves.
  // A draft came off a supplier invoice: it has a cost and no selling price, so the AI will never
  // quote it. Without somewhere to find them, 126 of these are invisible work.
  { key: 'needs_pricing', label: 'Needs pricing', test: (p) => p.status === 'draft' },
  { key: 'in_stock', label: 'In stock', test: (p) => p.availability_status === 'in_stock' },
  { key: 'out_of_stock', label: 'Out of stock', test: (p) => p.availability_status === 'out_of_stock' },
  { key: 'incoming', label: 'Incoming', test: (p) => p.availability_status === 'incoming' || p.incoming_quantity > 0 },
  { key: 'showroom', label: 'Showroom', test: (p) => p.showroom_quantity > 0 },
  { key: 'warehouse', label: 'Warehouse', test: (p) => p.warehouse_quantity > 0 },
  { key: 'storage', label: 'Storage', test: (p) => p.storage_quantity > 0 },
]
const money = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString()}`)

export default function CatalogListPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  // Sub-products for every product at once, keyed by product id. Empty for a tenant without Studio,
  // which is exactly why nothing below needs to know whether Studio exists.
  const [variants, setVariants] = useState<VariantsByProduct>({})
  // Collapsed by default — with a handful of sub-products in the whole system, nothing should shift
  // the list on load. Expansion is per product and deliberately not remembered across reloads.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { ask, dialog } = useConfirm()

  async function reload() {
    try {
      // Both in flight together; the variants call is best-effort, since the list is fully usable
      // without it and a failure there must never blank the catalog.
      const [res, vres] = await Promise.all([
        fetch('/api/catalog/products'),
        fetch('/api/catalog/variants').catch(() => null),
      ])
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setProducts(d.products || [])
      setVariants(vres?.ok ? ((await vres.json()).variants ?? {}) : {})
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })
  useEffect(() => { reload() }, [])

  async function del(p: CatalogProduct, e?: React.MouseEvent) {
    e?.preventDefault(); e?.stopPropagation()
    // Same guard, same wording, in the product's own dialog rather than the browser's. A delete that
    // also takes the Studio version, the sub-products and the documents is the kind a person should
    // read before confirming, and a native confirm() is the one chrome they have learned to dismiss.
    if (!(await ask({
      title: 'Delete product',
      body: <>Deleting <b>{p.name}</b> also removes its Studio version, its sub-products and its documents. This cannot be undone.</>,
      confirmLabel: 'Delete product',
      danger: true,
    }))) return
    const res = await fetch(`/api/catalog/products/${p.id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Delete failed'); return }
    setProducts((ps) => ps.filter((x) => x.id !== p.id))
  }

  async function importCsv(file: File) {
    const csv = await file.text()
    const res = await fetch('/api/catalog/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const d = await res.json()
    if (!res.ok) { setErr(d.error || 'Import failed'); return }
    setLoading(true); reload()
  }

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = products
    if (q) out = out.filter((p) => [p.name, p.sku, p.category, p.brand, ...(p.tags || [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    const f = FILTERS.find((x) => x.key === filter)
    if (f) out = out.filter(f.test)
    return out
  }, [products, search, filter])

  return (
    // `v2` carries the tokens every promoted class reads; `v2-embedded` undoes the 100dvh and hidden
    // overflow that belong to a route owning the viewport, and puts Tailwind's spacing utilities back
    // in charge inside this subtree.
    <div className="v2 v2-embedded p-4 sm:p-6 max-md:pb-16">
      {dialog}
      {/* No page title: the rail already says Catalog. The micro-label carries the count — the one
          thing the rail cannot say — and the rule runs to the verbs. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
          <i />Catalogue · {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>
        <s />
        {/* All four verbs at both widths. v1 hid three of them below md and floated an add button
            over the bottom-right corner instead — a position chosen for the old bottom tab bar,
            which is gone. .v2-act is small enough that four wrap onto two lines at 390px, which is
            a better answer than a fifth thing hovering over the swipe-up sheet and the Talk button. */}
        <div className="v2-bar">
          <a href="/api/catalog/export" className="v2-act tap-target"><Download className="w-3.5 h-3.5" /> Export</a>
          <button onClick={() => fileRef.current?.click()} className="v2-act tap-target"><Upload className="w-3.5 h-3.5" /> Import</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }} />
          <Link href="/catalog/names" className="v2-act tap-target"><ListChecks className="w-3.5 h-3.5" /> Names</Link>
          <Link href="/catalog/new" className="v2-act tap-target" data-solid><Plus className="w-3.5 h-3.5" /> Add product</Link>
        </div>
      </div>

      {/* What the business publishes on their own site, kept separate from what they physically
          stock. This panel writes to catalog_ingested_products and never to the inventory below. */}
      <ConnectWebsite />

      {/* Search — a rule, not a box, per the kit. Still the same live filter over the loaded list. */}
      <div className="v2-fld mb-4" style={{ position: 'relative' }}>
        <label htmlFor="catalog-q">Search</label>
        <input id="catalog-q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU, category, brand, tag…" style={{ paddingRight: 24 }} />
        <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setFilter('')} className="v2-chip" data-on={filter === '' || undefined}>All</button>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(filter === f.key ? '' : f.key)} className="v2-chip" data-on={filter === f.key || undefined}>{f.label}</button>
        ))}
      </div>

      {err && (
        <div className="v2-notice mb-4" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>{err}</p>
        </div>
      )}

      {loading ? <p className="v2-kick">Loading…</p> : list.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>{products.length === 0 ? 'Nothing in the catalogue yet' : 'No products match'}</b>
          <span>{products.length === 0
            ? 'Add what you sell and your AI can quote it, check stock against it, and answer questions about it. Import a CSV if you already keep a list somewhere else.'
            : 'Clear the search or choose another filter.'}</span>
          {products.length === 0 && <Link href="/catalog/new" className="v2-act" data-solid style={{ alignSelf: 'flex-start', marginTop: 4 }}><Plus className="w-3.5 h-3.5" /> Add your first product</Link>}
        </div>
      ) : (
        <>
          {/* TWO RENDERINGS, ONE ROW SET, and as on /contacts it is deliberate: a product genuinely
              has columns — price and four stock locations that only mean something lined up under
              each other. At 390px ten columns are a sideways scrollbar, so the phone gets .v2-row. */}
          <div className="hidden md:block">
            <table className="v2-tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="max-lg:hidden">Category</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Avail.</th>
                  <th className="max-xl:hidden" style={{ textAlign: 'right' }}>Showroom</th>
                  <th className="max-xl:hidden" style={{ textAlign: 'right' }}>Warehouse</th>
                  <th className="max-xl:hidden" style={{ textAlign: 'right' }}>Storage</th>
                  <th className="max-xl:hidden" style={{ textAlign: 'right' }}>Incoming</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const subs = variants[p.id] ?? []
                  const open = expanded.has(p.id)
                  const hue = p.status === 'draft' ? 'var(--v2-t1)' : HUE[p.availability_status]
                  return (
                  <Fragment key={p.id}>
                  <tr style={{ ['--chan' as string]: hue }}>
                    <td>
                      <div className="flex items-center gap-1">
                        {/* Only products that actually have sub-products get a control. Everything else
                            renders precisely as before — no placeholder, no disabled arrow, nothing to
                            suggest something is missing. */}
                        {subs.length > 0 ? (
                          <button
                            type="button" onClick={() => toggle(p.id)}
                            aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} sub-products of ${p.name}`}
                            className="v2-ico" style={{ ['--ghue' as string]: hue }}
                          ><ChevronRight className="transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined }} /></button>
                        ) : <span style={{ width: 4 }} />}
                        <Link href={`/catalog/${p.id}`} className="flex items-center gap-3 min-w-0">
                          <Thumb p={p} />
                          <span className="min-w-0">
                            <span className="block truncate" style={{ color: 'var(--v2-ink)', fontWeight: 500 }}>{p.name}</span>
                            <span className="block truncate" style={{ fontSize: 12, color: 'var(--v2-mute)' }}>{p.sku || '—'}{p.brand ? ` · ${p.brand}` : ''}{subs.length > 0 ? ` · ${subs.length} sub-product${subs.length === 1 ? '' : 's'}` : ''}</span>
                          </span>
                        </Link>
                      </div>
                    </td>
                    <td className="max-lg:hidden" style={{ color: 'var(--v2-ink-72)' }}>{p.category || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink)' }}>{money(p.price)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink)', fontWeight: 500 }}>{totalAvailable(p)}</td>
                    <td className="max-xl:hidden" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink-72)' }}>{p.showroom_quantity}</td>
                    <td className="max-xl:hidden" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink-72)' }}>{p.warehouse_quantity}</td>
                    <td className="max-xl:hidden" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink-72)' }}>{p.storage_quantity}</td>
                    <td className="max-xl:hidden" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink-72)' }}>{p.incoming_quantity}</td>
                    <td>{p.status === 'draft' ? (
                      <span className="v2-stat" title="Created from a supplier invoice. It has a cost but no selling price, so the AI will never quote it.">Needs pricing</span>
                    ) : (
                      <span className="v2-stat">{AVAILABILITY_LABELS[p.availability_status]}</span>
                    )}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={(e) => del(p, e)} aria-label={`Delete ${p.name}`} title="Delete" className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }}><Trash2 /></button>
                    </td>
                  </tr>
                  {open && subs.map((v) => (
                    <tr key={v.id} data-sub style={{ ['--chan' as string]: hue }}>
                      <td style={{ paddingLeft: 56 }}>
                        <span style={{ color: 'var(--v2-ink)' }}>{v.name}</span>
                        <span className="block" style={{ fontSize: 12, color: 'var(--v2-mute)' }}>{v.sku || '—'}</span>
                      </td>
                      <td className="max-lg:hidden" style={{ fontSize: 12, color: 'var(--v2-mute)' }}>Sub-product</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--v2-ink)' }}>{money(v.price)}</td>
                      {/* Stock and status are tracked on the parent product, not per sub-product, so
                          these stay blank rather than repeating the parent's numbers as if they were
                          the variant's own. */}
                      <td colSpan={7} />
                    </tr>
                  ))}
                  </Fragment>
                )})}
              </tbody>
            </table>
          </div>

          <div className="v2-list md:hidden -mx-4">
            {list.map((p) => {
              const subs = variants[p.id] ?? []
              const open = expanded.has(p.id)
              const hue = p.status === 'draft' ? 'var(--v2-t1)' : HUE[p.availability_status]
              return (
              <Fragment key={p.id}>
              <div style={{ position: 'relative' }}>
              <Link href={`/catalog/${p.id}`} className="v2-row tap-target" data-click style={{ ['--chan' as string]: hue, paddingRight: 48 }}>
                <Thumb p={p} big />
                <div className="v2-m">
                  <p className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{p.name}</span>
                    <span className="v2-stat">{p.status === 'draft' ? 'Needs pricing' : AVAILABILITY_LABELS[p.availability_status]}</span>
                  </p>
                  <span>
                    {p.sku || '—'}{p.category ? ` · ${p.category}` : ''}
                    {' · '}Showroom {p.showroom_quantity} · Wh {p.warehouse_quantity} · St {p.storage_quantity}{p.incoming_quantity ? ` · In ${p.incoming_quantity}` : ''}
                    {p.expected_arrival_date && p.incoming_quantity > 0 ? ` · arrives ${p.expected_arrival_date}` : ''}
                  </span>
                </div>
                <div className="v2-meta">
                  <em style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.price)}</em>
                </div>
              </Link>
              <button onClick={(e) => del(p, e)} aria-label={`Delete ${p.name}`} className="v2-ico"
                      style={{ ['--ghue' as string]: 'var(--v2-red)', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}><Trash2 /></button>
              </div>
              {/* Same rule as the table: no control at all unless there is something behind it. */}
              {subs.length > 0 && (
                <>
                  <button
                    type="button" onClick={() => toggle(p.id)} aria-expanded={open}
                    className="v2-row tap-target" data-click style={{ ['--chan' as string]: hue, textAlign: 'left' }}
                  >
                    <ChevronRight className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: 'var(--v2-mute)', transform: open ? 'rotate(90deg)' : undefined }} />
                    <div className="v2-m"><p>{subs.length} sub-product{subs.length === 1 ? '' : 's'}</p></div>
                  </button>
                  {open && subs.map((v) => (
                    <div key={v.id} className="v2-row" data-sub style={{ ['--chan' as string]: hue }}>
                      <div className="v2-m">
                        <p><span className="truncate">{v.name}</span></p>
                        <span>{v.sku || '—'}</span>
                      </div>
                      <div className="v2-meta"><em style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v.price)}</em></div>
                    </div>
                  ))}
                </>
              )}
              </Fragment>
            )})}
          </div>
        </>
      )}
    </div>
  )
}

// The catalogue's thumbnail is the kit's frame at row size — one component, one --shot value, so a
// 56px row picture and the 112px block on the detail screen cannot drift apart.
function Thumb({ p, big }: { p: CatalogProduct; big?: boolean }) {
  return (
    <span className="v2-shot" style={{ ['--shot' as string]: big ? '56px' : '36px' }}>
      {p.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.image_url} alt="" />
        : <i><Package /></i>}
    </span>
  )
}
