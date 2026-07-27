'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Layers } from 'lucide-react'
import { STUDIO_STATUS_LABELS, type StudioProduct } from '@/lib/studio/types'

type Row = StudioProduct & { variants?: { id: string }[] }

export default function StudioCatalogPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch('/api/studio/products').then((r) => r.json()).then((d) => { setRows(d.products || []); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter((p) => [p.name, p.category, p.description].filter(Boolean).some((s) => String(s).toLowerCase().includes(t)))
  }, [rows, q])

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Catalog</h1>
        <Link href="/studio/new" className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add product</Link>
      </div>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="h-11 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-strong p-10 text-center">
          <p className="text-sm text-muted">{rows.length === 0 ? 'No products yet.' : 'No matches.'}</p>
          {rows.length === 0 && <Link href="/studio/new" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent">Add your first product →</Link>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => {
            const cover = p.photos?.[0]
            const vcount = p.variants?.length || 0
            return (
              <Link key={p.id} href={`/studio/${p.id}`} className="group overflow-hidden rounded-xl border border-hairline-strong bg-white transition hover:shadow-sm">
                <div className="aspect-square w-full bg-sunken">
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center text-xs text-muted">No photo</span>}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span>{p.base_price != null ? `$${Number(p.base_price).toLocaleString()}` : '—'}</span>
                    {vcount > 0 && <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" /> {vcount}</span>}
                  </div>
                  {p.status !== 'active' && <span className="mt-1 inline-block rounded bg-sunken px-1.5 py-0.5 text-[10px] text-subtle">{STUDIO_STATUS_LABELS[p.status]}</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
