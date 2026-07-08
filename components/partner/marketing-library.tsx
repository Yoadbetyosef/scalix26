'use client'

import { useEffect, useState, useCallback } from 'react'
import { EmptyRow } from '@/components/partner/ui'
import { Search, Download, FileText, Presentation, MessageSquare, Image as ImageIcon, File } from 'lucide-react'

interface Asset { id: string; title: string; description: string | null; category: string; file_url: string; tags: string[]; download_count: number }

const ICON: Record<string, typeof FileText> = { one_pager: FileText, script: MessageSquare, deck: Presentation, template: MessageSquare, logo: ImageIcon, video: File }

export function MarketingLibrary() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (query = '') => {
    setLoading(true)
    const res = await fetch(`/api/partner/marketing${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    const j = await res.json(); setAssets(j.assets || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  function download(a: Asset) {
    fetch('/api/partner/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
    window.open(a.file_url, '_blank')
  }

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q)} placeholder="Search assets…"
          className="h-10 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>
      {loading ? <EmptyRow>Loading…</EmptyRow> : assets.length === 0 ? <EmptyRow>No assets found.</EmptyRow> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => {
            const Icon = ICON[a.category] || File
            return (
              <div key={a.id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Icon className="h-5 w-5" /></div>
                <div className="font-medium text-ink">{a.title}</div>
                {a.description && <div className="mt-0.5 flex-1 text-sm text-subtle">{a.description}</div>}
                <button onClick={() => download(a)} className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">
                  <Download className="h-4 w-4" /> Download
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
