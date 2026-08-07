'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Package, Upload, Download, Trash2, ListChecks, ChevronRight } from 'lucide-react'
import type { VariantsByProduct } from '@/lib/catalog/variants'
import { AVAILABILITY_LABELS, totalAvailable, type CatalogProduct, type AvailabilityStatus } from '@/lib/catalog/types'
import { ConnectWebsite } from '@/components/catalog/connect-website'

const badge: Record<AvailabilityStatus, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  out_of_stock: 'bg-red-50 text-red-700',
  incoming: 'bg-amber-50 text-amber-700',
  special_order: 'bg-violet-50 text-violet-700',
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
    if (!confirm(`Delete “${p.name}”? This also removes its Studio version, sub-products and documents.`)) return
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
    <div className="p-4 sm:p-6 max-md:pb-24">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Business Catalog</h1>
          <p className="text-sm text-subtle">{products.length} products</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/catalog/export" className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-ink hover:bg-sunken"><Download className="h-4 w-4" /> Export</a>
          <button onClick={() => fileRef.current?.click()} className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-ink hover:bg-sunken"><Upload className="h-4 w-4" /> Import</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }} />
          <Link href="/catalog/names" className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-ink hover:bg-sunken"><ListChecks className="h-4 w-4" /> Product names</Link>
          <Link href="/catalog/new" className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90">
            <Plus className="h-4 w-4" /> Add product
          </Link>
        </div>
      </div>

      {/* What the business publishes on their own site, kept separate from what they physically
          stock. This panel writes to catalog_ingested_products and never to the inventory below. */}
      <ConnectWebsite />

      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, category, brand, tag…" className="h-11 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button onClick={() => setFilter('')} className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === '' ? 'bg-ink text-white' : 'border border-hairline-strong text-subtle hover:text-ink'}`}>All</button>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(filter === f.key ? '' : f.key)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === f.key ? 'bg-ink text-white' : 'border border-hairline-strong text-subtle hover:text-ink'}`}>{f.label}</button>
        ))}
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      {loading ? <p className="text-sm text-muted">Loading…</p> : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-strong p-10 text-center">
          <Package className="mx-auto mb-2 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">{products.length === 0 ? 'No products yet.' : 'No products match.'}</p>
          {products.length === 0 && <Link href="/catalog/new" className="mt-3 inline-block text-sm font-medium text-accent-strong hover:underline">Add your first product</Link>}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-hairline-strong bg-white md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-3 py-3 font-medium">Category</th>
                  <th className="px-3 py-3 font-medium text-right">Price</th>
                  <th className="px-3 py-3 font-medium text-right">Avail.</th>
                  <th className="px-3 py-3 font-medium text-right">Showroom</th>
                  <th className="px-3 py-3 font-medium text-right">Warehouse</th>
                  <th className="px-3 py-3 font-medium text-right">Storage</th>
                  <th className="px-3 py-3 font-medium text-right">Incoming</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const subs = variants[p.id] ?? []
                  const open = expanded.has(p.id)
                  return (
                  <Fragment key={p.id}>
                  <tr className="border-b border-hairline last:border-0 hover:bg-sunken/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Only products that actually have sub-products get a control. Everything else
                            renders precisely as before — no placeholder, no disabled arrow, nothing to
                            suggest something is missing. */}
                        {subs.length > 0 ? (
                          <button
                            type="button" onClick={() => toggle(p.id)}
                            aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} sub-products of ${p.name}`}
                            className="-ml-1 rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                          ><ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} /></button>
                        ) : <span className="w-1" />}
                      <Link href={`/catalog/${p.id}`} className="flex items-center gap-3">
                        <Thumb p={p} />
                        <span><span className="font-medium text-ink hover:underline">{p.name}</span><span className="block text-xs text-subtle">{p.sku || '—'}{p.brand ? ` · ${p.brand}` : ''}{subs.length > 0 ? ` · ${subs.length} sub-product${subs.length === 1 ? '' : 's'}` : ''}</span></span>
                      </Link>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{p.category || '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">{money(p.price)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-ink">{totalAvailable(p)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.showroom_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.warehouse_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.storage_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.incoming_quantity}{p.expected_arrival_date ? '' : ''}</td>
                    <td className="px-3 py-3">{p.status === 'draft' ? (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700" title="Created from a supplier invoice. It has a cost but no selling price, so the AI will never quote it.">Needs pricing</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[p.availability_status]}`}>{AVAILABILITY_LABELS[p.availability_status]}</span>
                    )}</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={(e) => del(p, e)} aria-label={`Delete ${p.name}`} title="Delete" className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                  {open && subs.map((v) => (
                    <tr key={v.id} className="border-b border-hairline bg-sunken/30 last:border-0">
                      <td className="py-2 pl-14 pr-4">
                        <span className="text-ink">{v.name}</span>
                        <span className="block text-xs text-subtle">{v.sku || '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-subtle">Sub-product</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{money(v.price)}</td>
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

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {list.map((p) => {
              const subs = variants[p.id] ?? []
              const open = expanded.has(p.id)
              return (
              <div key={p.id} className="rounded-xl border border-hairline-strong bg-white">
              <Link href={`/catalog/${p.id}`} className="flex gap-3 p-3 active:bg-sunken/60">
                <Thumb p={p} big />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink line-clamp-1">{p.name}</span>
                    <div className="flex items-center gap-1">
                      <span className="tabular-nums text-sm text-ink">{money(p.price)}</span>
                      <button onClick={(e) => del(p, e)} aria-label={`Delete ${p.name}`} className="-mr-1 rounded-lg p-1.5 text-muted active:bg-red-50 active:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="text-xs text-subtle">{p.sku || '—'}{p.category ? ` · ${p.category}` : ''}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {p.status === 'draft'
                      ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Needs pricing</span>
                      : <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge[p.availability_status]}`}>{AVAILABILITY_LABELS[p.availability_status]}</span>}
                    <span className="text-[11px] text-muted">Showroom {p.showroom_quantity} · Wh {p.warehouse_quantity} · St {p.storage_quantity}{p.incoming_quantity ? ` · In ${p.incoming_quantity}` : ''}</span>
                  </div>
                  {p.expected_arrival_date && p.incoming_quantity > 0 && <div className="mt-0.5 text-[11px] text-amber-600">Arrives {p.expected_arrival_date}</div>}
                </div>
              </Link>
              {/* Same rule as the table: no control at all unless there is something behind it. */}
              {subs.length > 0 && (
                <>
                  <button
                    type="button" onClick={() => toggle(p.id)} aria-expanded={open}
                    className="flex w-full items-center gap-1 border-t border-hairline px-3 py-2 text-left text-xs font-medium text-subtle active:bg-sunken/60"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                    {subs.length} sub-product{subs.length === 1 ? '' : 's'}
                  </button>
                  {open && (
                    <ul className="border-t border-hairline">
                      {subs.map((v) => (
                        <li key={v.id} className="flex items-baseline justify-between gap-3 bg-sunken/30 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink">{v.name}</span>
                            <span className="block text-[11px] text-subtle">{v.sku || '—'}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-sm text-ink">{money(v.price)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              </div>
            )})}
          </div>
        </>
      )}

      {/* Mobile floating add button */}
      <Link href="/catalog/new" aria-label="Add product" className="fixed bottom-[86px] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-e3 active:scale-95 md:hidden">
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  )
}

function Thumb({ p, big }: { p: CatalogProduct; big?: boolean }) {
  const size = big ? 'h-16 w-16' : 'h-9 w-9'
  return p.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.image_url} alt="" className={`${size} flex-shrink-0 rounded-lg object-cover`} />
  ) : (
    <span className={`${size} flex flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-muted`}><Package className="h-4 w-4" /></span>
  )
}
