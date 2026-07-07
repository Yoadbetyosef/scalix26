'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Package, Upload, Download } from 'lucide-react'
import { AVAILABILITY_LABELS, totalAvailable, type CatalogProduct, type AvailabilityStatus } from '@/lib/catalog/types'

const badge: Record<AvailabilityStatus, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  out_of_stock: 'bg-red-50 text-red-700',
  incoming: 'bg-amber-50 text-amber-700',
  special_order: 'bg-violet-50 text-violet-700',
}
const FILTERS: { key: string; label: string; test: (p: CatalogProduct) => boolean }[] = [
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
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function reload() {
    try {
      const res = await fetch('/api/catalog/products')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setProducts(d.products || [])
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

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
          <Link href="/catalog/new" className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90">
            <Plus className="h-4 w-4" /> Add product
          </Link>
        </div>
      </div>

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
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-sunken/50">
                    <td className="px-4 py-3">
                      <Link href={`/catalog/${p.id}`} className="flex items-center gap-3">
                        <Thumb p={p} />
                        <span><span className="font-medium text-ink hover:underline">{p.name}</span><span className="block text-xs text-subtle">{p.sku || '—'}{p.brand ? ` · ${p.brand}` : ''}</span></span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{p.category || '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink">{money(p.price)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-ink">{totalAvailable(p)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.showroom_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.warehouse_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.storage_quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{p.incoming_quantity}{p.expected_arrival_date ? '' : ''}</td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[p.availability_status]}`}>{AVAILABILITY_LABELS[p.availability_status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {list.map((p) => (
              <Link key={p.id} href={`/catalog/${p.id}`} className="flex gap-3 rounded-xl border border-hairline-strong bg-white p-3 active:bg-sunken/60">
                <Thumb p={p} big />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink line-clamp-1">{p.name}</span>
                    <span className="tabular-nums text-sm text-ink">{money(p.price)}</span>
                  </div>
                  <div className="text-xs text-subtle">{p.sku || '—'}{p.category ? ` · ${p.category}` : ''}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge[p.availability_status]}`}>{AVAILABILITY_LABELS[p.availability_status]}</span>
                    <span className="text-[11px] text-muted">Showroom {p.showroom_quantity} · Wh {p.warehouse_quantity} · St {p.storage_quantity}{p.incoming_quantity ? ` · In ${p.incoming_quantity}` : ''}</span>
                  </div>
                  {p.expected_arrival_date && p.incoming_quantity > 0 && <div className="mt-0.5 text-[11px] text-amber-600">Arrives {p.expected_arrival_date}</div>}
                </div>
              </Link>
            ))}
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
