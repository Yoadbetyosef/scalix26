'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ExternalLink, ImageOff, Loader2, Phone } from 'lucide-react'

// What the website gave us, searchable.
//
// Not a browsable list: with 9,000 products nobody pages through one. Search is also what the agent
// does mid-call — a customer says a product name, the agent looks it up — so typing here shows the
// answer a caller would get. That makes this a way to test the agent, not a receipt for an import.
//
// Read-only by construction: there is no write path from this component, and it sits under the
// website section, separate from the physical inventory list further down the page.

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

// What the voice agent would receive for this phrase — from the same function it calls on a live
// call, so the tenant can tune their catalogue before a customer ever hears it.
interface AgentAnswer {
  say: string
  resolved: boolean
  clarifying: boolean
  matched: number
  latencyMs: number
  timedOut: boolean
  groups: Array<{ label: string; count: number; priceMin: number | null; priceMax: number | null; axis: string | null; axisValues: string[] }>
}

const money = (p: number | null, currency: string | null) => {
  if (p === null) return null
  const symbol = currency === 'USD' || !currency ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return symbol ? `${symbol}${p.toLocaleString()}` : `${p.toLocaleString()} ${currency}`
}

export function IngestedProducts() {
  const [products, setProducts] = useState<IngestedProduct[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [agent, setAgent] = useState<AgentAnswer | null>(null)
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
      setAgent(json.agent ?? null)
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
    <div className="mt-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />What we found on your site</p>
        <s />
        <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>Read-only · not your stock list</span>
      </div>

      {/* The line that makes a bad sync obvious without searching for anything. */}
      <p className="v2-kick" style={{ marginBottom: 14 }}>
        {stats.total.toLocaleString()} synced · {stats.withPrice.toLocaleString()} with a price ({pct(stats.withPrice)}%) · {stats.withImage.toLocaleString()} with an image ({pct(stats.withImage)}%)
      </p>

      <div className="v2-fld mb-4" style={{ position: 'relative' }}>
        <label htmlFor="ingested-q">Ask it the way a customer would</label>
        <input
          id="ingested-q"
          value={q}
          onChange={(e) => onType(e.target.value)}
          placeholder="“how much is the emerald cut halo ring”"
          style={{ paddingRight: 24 }}
        />
        {searching
          ? <Loader2 className="w-4 h-4 animate-spin" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />
          : <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />}
      </div>

      {/* The answer the agent would give, first — because that is the thing being tested. The rows
          below are the evidence behind it. It is a quotation, so it is set as one: the kit's rule in
          the margin, in the hue that says whether the agent actually resolved the question. */}
      {agent && (
        <div className="mb-4" style={{ ['--chan' as string]: agent.resolved ? 'var(--v2-t3)' : 'var(--v2-mute)' }}>
          <p className="v2-kick" style={{ ['--ghue' as string]: agent.resolved ? 'var(--v2-t3)' : 'var(--v2-mute)' }}>
            <Phone className="w-3 h-3" /> What your AI would say on a call
          </p>
          <p className="v2-quote">“{agent.say}”</p>
          <p className="v2-kick" style={{ marginTop: 8 }}>
            {agent.matched} product{agent.matched === 1 ? '' : 's'} matched
            {agent.groups.length > 0 && ` · grouped into ${agent.groups.length}`}
            {agent.groups[0]?.axis && ` · asks about ${agent.groups[0].axis}`}
            {' · '}{agent.latencyMs}ms{agent.timedOut && ' · timed out'}
          </p>
        </div>
      )}

      {!products.length ? (
        <div className="v2-card" data-empty>
          <b>Nothing matches “{q}”</b>
          <span>Your AI would come up empty on that too. Try the words a customer would actually use.</span>
        </div>
      ) : (
        <>
          {!q && <p className="v2-kick" style={{ marginBottom: 6 }}>Most recently synced</p>}
          <div className="v2-list">
            {products.map((p) => (
              <div key={p.id} className="v2-row" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>
                <span className="v2-shot" style={{ ['--shot' as string]: '40px' }}>
                  {p.image_url
                    // Hotlinked straight from the shop — nothing is copied into our storage.
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image_url} alt="" loading="lazy" />
                    : <i title="No image on the site"><ImageOff /></i>}
                </span>
                <div className="v2-m">
                  <p><span className="truncate" title={p.title}>{p.title}</span></p>
                  <span>
                    {money(p.price, p.currency) ?? 'no price'}
                    {p.sku && ` · ${p.sku}`}
                    {p.availability === 'out_of_stock' && ' · out of stock'}
                  </span>
                </div>
                {p.product_url && (
                  <a
                    href={p.product_url} target="_blank" rel="noopener noreferrer"
                    title="Open on your site" aria-label="Open on your site"
                    className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}
                  >
                    <ExternalLink />
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
