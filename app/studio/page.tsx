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
    <div className="v2 v2-embedded mx-auto max-w-5xl p-4 sm:p-6 max-md:pb-16">
      {/* No page title: the rail says Studio. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Studio catalogue · {rows.length}</p>
        <s />
        <Link href="/studio/new" className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
          <Plus className="w-3.5 h-3.5" /> Add product
        </Link>
      </div>

      <div className="v2-fld mb-6" style={{ position: 'relative', maxWidth: 380 }}>
        <label htmlFor="studio-q">Search</label>
        <input id="studio-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, category or description…" style={{ paddingRight: 24 }} />
        <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />
      </div>

      {loading ? (
        <p className="v2-kick">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>{rows.length === 0 ? 'Nothing in the studio yet' : `Nothing matches “${q}”`}</b>
          <span>{rows.length === 0
            ? 'A studio product carries its own photos, its sub-products, its documents and its public page.'
            : 'Clear the search to see all ' + rows.length + '.'}</span>
          {rows.length === 0 && (
            <Link href="/studio/new" className="v2-act" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)', alignSelf: 'flex-start', marginTop: 4 }}>
              <Plus className="w-3.5 h-3.5" /> Add your first product
            </Link>
          )}
        </div>
      ) : (
        <div className="v2-tiles2">
          {filtered.map((p) => {
            const cover = p.photos?.[0]
            const vcount = p.variants?.length || 0
            return (
              /* §24, FIXED. The card used to send you to /catalog/[id] whenever the studio product had
                 a catalog twin — which it always does, because the twin is created lazily the first
                 time the catalogue screen asks for it. The consequence was that /studio/[id] existed,
                 was fully built, and nothing in the product could reach it. This is the studio's own
                 list, so its card opens the studio's own screen. The catalogue screen is still one tap
                 away from the rail, and nothing else linked here. */
              <Link key={p.id} href={`/studio/${p.id}`} className="v2-tile2 tap-target" data-click>
                <span className="v2-tile2-img">
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" />
                    : <i><Layers /></i>}
                </span>
                <span className="v2-tile2-body">
                  <b>{p.name}</b>
                  <span>
                    {p.base_price != null ? `$${Number(p.base_price).toLocaleString()}` : '—'}
                    {vcount > 0 ? ` · ${vcount} sub-product${vcount === 1 ? '' : 's'}` : ''}
                  </span>
                  {p.status !== 'active' && (
                    <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)', marginTop: 6 }}>{STUDIO_STATUS_LABELS[p.status]}</span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
