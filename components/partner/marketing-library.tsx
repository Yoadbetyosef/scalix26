'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { EmptyRow } from '@/components/partner/ui'
import { Search, Download, Eye, Star, X, Copy, FileText, Layers } from 'lucide-react'

interface Asset { id: string; title: string; description: string | null; category: string; collection: string | null; file_url: string | null; content: string | null; tags: string[]; updated_at: string; favorited: boolean }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Browse the toolkit by what the partner is trying to do, not by internal collection names.
const GOALS: { key: string; hint: string; match: (a: Asset) => boolean }[] = [
  { key: 'Start selling today', hint: 'Scripts & questions to book meetings now', match: (a) => a.collection === 'Sales' && !a.tags?.includes('objections') },
  { key: 'Run paid ads', hint: 'Ad copy & keywords for Meta and Google', match: (a) => a.collection === 'Ads' },
  { key: 'Follow up with prospects', hint: 'Email & SMS sequences that close', match: (a) => a.collection === 'Follow-up' },
  { key: 'Handle objections', hint: 'Answers to every "no"', match: (a) => !!a.tags?.includes('objections') },
  { key: 'Sell by vertical', hint: 'Everything to sell one industry', match: (a) => a.collection === 'Vertical Kits' },
  { key: 'Build your brand', hint: 'Positioning, proof & presence', match: (a) => a.collection === 'Brand' || a.collection === 'Marketing' || a.collection === 'Case Studies' },
]
const goalOf = (a: Asset) => GOALS.find((g) => g.match(a))?.key || 'Build your brand'

export function MarketingLibrary() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [q, setQ] = useState('')
  const [active, setActive] = useState<string>('All')
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Asset | null>(null)

  const load = useCallback(async (query = '') => {
    setLoading(true)
    const res = await fetch(`/api/partner/marketing${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    const j = await res.json(); setAssets(j.assets || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const shown = assets.filter((a) => active === 'All' ? true : active === 'Favorites' ? a.favorited : goalOf(a) === active)
  const availableGoals = GOALS.filter((g) => assets.some((a) => g.match(a)))

  async function toggleFav(a: Asset) {
    const favorited = !a.favorited
    setAssets((xs) => xs.map((x) => x.id === a.id ? { ...x, favorited } : x))
    await fetch('/api/partner/marketing', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: a.id, favorite: favorited }) })
  }
  function download(a: Asset) {
    fetch('/api/partner/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
    if (a.content) {
      const blob = new Blob([`${a.title}\n\n${a.content}`], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = `${slug(a.title)}.txt`; el.click(); URL.revokeObjectURL(url)
      toast.success('Downloaded')
    } else if (a.file_url) { window.open(a.file_url, '_blank') }
    else { setPreview(a) }
  }

  const chips = ['All', 'Favorites', ...availableGoals.map((g) => g.key)]
  const isVertical = (a: Asset) => a.collection === 'Vertical Kits'

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Revenue Toolkit</h2>
        <p className="text-sm text-subtle">Ready-to-use scripts, ad copy, sequences, and industry kits — pick a goal and start selling.</p>
      </div>

      <div className="relative mb-3 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q)} placeholder="Search the toolkit…"
          className="h-10 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button key={c} onClick={() => setActive(c)} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${active === c ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'}`}>
            {c === 'Favorites' && <Star className="h-3 w-3" />}{c === 'Sell by vertical' && <Layers className="h-3 w-3" />}{c}
          </button>
        ))}
      </div>

      {active === 'All' && !q && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {availableGoals.map((g) => (
            <button key={g.key} onClick={() => setActive(g.key)} className="rounded-xl border border-hairline bg-surface p-3 text-left shadow-e1 transition-colors hover:border-accent/40">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ink">{g.key === 'Sell by vertical' && <Layers className="h-3.5 w-3.5 text-accent-strong" />}{g.key}</div>
              <div className="mt-0.5 text-xs text-subtle">{g.hint}</div>
            </button>
          ))}
        </div>
      )}

      {loading ? <EmptyRow>Loading…</EmptyRow> : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><FileText className="h-5 w-5" /></div>
          <h3 className="font-semibold text-ink">{active === 'Favorites' ? 'No favorites yet' : 'Nothing here yet'}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">{active === 'Favorites' ? 'Star the scripts and templates you use most so they’re one tap away.' : 'Try another goal or clear your search — every asset here is ready-to-use sales copy.'}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <div key={a.id} className={`flex flex-col rounded-2xl border bg-surface p-4 shadow-e1 ${isVertical(a) ? 'border-accent/30' : 'border-hairline'}`}>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isVertical(a) ? 'bg-accent/10 text-accent-strong' : 'bg-sunken text-subtle'}`}>{isVertical(a) ? 'Vertical Kit' : a.category}</span>
                <button onClick={() => toggleFav(a)} aria-label="Favorite" className={a.favorited ? 'text-amber-400' : 'text-muted hover:text-amber-400'}><Star className={`h-4 w-4 ${a.favorited ? 'fill-amber-400' : ''}`} /></button>
              </div>
              <div className="font-medium text-ink">{a.title}</div>
              {a.description && <div className="mt-0.5 flex-1 text-sm text-subtle">{a.description}</div>}
              {a.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{a.tags.slice(0, 3).map((t) => <span key={t} className="rounded bg-sunken px-1.5 py-0.5 text-[10px] text-muted">{t}</span>)}</div>}
              <div className="mt-2 text-[11px] text-muted">Updated {fmtDate(a.updated_at)}</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setPreview(a)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Eye className="h-4 w-4" /> Preview</button>
                <button onClick={() => download(a)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><Download className="h-4 w-4" /> Download</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
              <div><div className="font-semibold text-ink">{preview.title}</div><div className="text-xs text-muted">{preview.category} · {goalOf(preview)}</div></div>
              <button onClick={() => setPreview(null)} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {preview.content ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{preview.content}</pre> : <p className="text-sm text-subtle">No preview available.</p>}
            </div>
            <div className="flex gap-2 border-t border-hairline p-4">
              {preview.content && <button onClick={() => { navigator.clipboard.writeText(preview.content!); toast.success('Copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Copy className="h-4 w-4" /> Copy</button>}
              <button onClick={() => download(preview)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><Download className="h-4 w-4" /> Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
