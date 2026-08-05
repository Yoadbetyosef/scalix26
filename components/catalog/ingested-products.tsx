'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ExternalLink, ImageOff, Loader2 } from 'lucide-react'

// What the website gave us, searchable.
//
// Not a browsable list: with 9,000 products nobody pages through one. Search is also what the agent
// does mid-call — a customer says a product name, the agent looks it up — so typing here shows the
// answer a caller would get. That makes this a way to test the agent, not a receipt for an import.
//
// Read-only by construction: there is no write path from this component, and it sits inside the
// website card, separate from the physical inventory list further down the page.

interface IngestedProduct {
  id: string
  title: string
  price: number | null
  currency: string | null
  sku: string | null
  image_url: string | null
  product_url: string | null
  availability: string | null
}

interface Stats { total: number; withPrice: number; withImage: number }

const money = (p: number | null, currency: string | null) => {
  if (p === null) return null
  const symbol = currency === 'USD' || !currency ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return symbol ? `${symbol}${p.toLocaleString()}` : `${p.toLocaleString()} ${currency}`
}

export function IngestedProducts() {
  const [products, setProducts] = useState<IngestedProduct[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (term: string) => {
    try {
      const res = await fetch(`/api/catalog/ingested${term ? `?q=${encodeURIComponent(term)}` : ''}`)
      if (!res.ok) return
      const json = await res.json()
      setProducts(json.products ?? [])
      setStats(json.stats ?? null)
    } finally { setLoading(false); setSearching(false) }
  }, [])

  useEffect(() => { void load('') }, [load])

  // Typing shouldn't fire a query per keystroke, and shouldn't feel like it's waiting either.
  function onType(value: string) {
    setQ(value)
    setSearching(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void load(value.trim()) }, 250)
  }

  if (loading) return null
  if (!stats || stats.total === 0) return null      // nothing synced yet: the panel above says so

  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0)

  return (
    <div className="border-t border-hairline px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">What we found on your site</h3>
        <span className="text-[11px] uppercase tracking-wide text-muted">Read-only · not your stock list</span>
      </div>

      {/* The line that makes a bad sync obvious without searching for anything. */}
      <p className="mb-3 text-xs text-subtle">
        <strong className="font-semibold text-ink">{stats.total.toLocaleString()}</strong> products synced ·{' '}
        <span className={stats.withPrice < stats.total ? 'text-ink' : ''}>
          {stats.withPrice.toLocaleString()} with a price ({pct(stats.withPrice)}%)
        </span>{' '}
        · {stats.withImage.toLocaleString()} with an image ({pct(stats.withImage)}%)
      </p>

      <div className="relative mb-3">
        {searching
          ? <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
          : <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
        <input
          value={q}
          onChange={(e) => onType(e.target.value)}
          placeholder="Search by product name or SKU — the way your AI looks one up on a call"
          className="h-11 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      {!products.length ? (
        <p className="py-6 text-center text-sm text-muted">
          Nothing matches <strong className="text-ink">{q}</strong>. Your AI would come up empty on that too.
        </p>
      ) : (
        <>
          {!q && <p className="mb-2 text-xs text-muted">Most recently synced</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-hairline px-3 py-2">
                {p.image_url ? (
                  // Hotlinked straight from the shop — nothing is copied into our storage.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-sunken" title="No image on the site">
                    <ImageOff className="h-4 w-4 text-muted" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink" title={p.title}>{p.title}</p>
                  <p className="text-xs text-subtle">
                    {money(p.price, p.currency) ?? <span className="text-muted">no price</span>}
                    {p.sku && <span className="text-muted"> · {p.sku}</span>}
                    {p.availability === 'out_of_stock' && <span className="text-muted"> · out of stock</span>}
                  </p>
                </div>
                {p.product_url && (
                  <a
                    href={p.product_url} target="_blank" rel="noopener noreferrer"
                    title="Open on your site"
                    className="flex-shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
