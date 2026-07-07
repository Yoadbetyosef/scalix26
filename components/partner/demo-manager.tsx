'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Panel, EmptyRow } from '@/components/partner/ui'
import { Sparkles, Copy, ExternalLink, Eye } from 'lucide-react'

interface Demo { id: string; public_slug: string; prospect_name: string; industry: string | null; view_count: number; last_viewed_at: string | null; created_at: string }

export function DemoManager({ canCreate }: { canCreate: boolean }) {
  const [demos, setDemos] = useState<Demo[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ prospectName: '', website: '', industry: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => {
    const res = await fetch('/api/partner/demos'); const j = await res.json()
    setDemos(j.demos || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const demoUrl = (slug: string) => `${origin}/demo/${slug}`

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const res = await fetch('/api/partner/demos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    toast.success('Demo generated'); setForm({ prospectName: '', website: '', industry: '', phone: '' }); load()
    if (j.demo?.public_slug) { navigator.clipboard.writeText(demoUrl(j.demo.public_slug)); toast.success('Link copied to clipboard') }
  }

  const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

  return (
    <div className="space-y-6">
      {canCreate && (
        <Panel title="Generate a demo">
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
            <input required value={form.prospectName} onChange={(e) => setForm((f) => ({ ...f, prospectName: e.target.value }))} placeholder="Business name *" className={input} />
            <input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="Website (we'll pull branding)" className={input} />
            <input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} placeholder="Industry" className={input} />
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className={input} />
            <div className="sm:col-span-2">
              <button disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">
                <Sparkles className="h-4 w-4" /> {busy ? 'Generating…' : 'Generate demo'}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Your demos">
        {loading ? <EmptyRow>Loading…</EmptyRow> : demos.length === 0 ? <EmptyRow>No demos yet — generate one above and send it to a prospect.</EmptyRow> : (
          <div className="divide-y divide-hairline">
            {demos.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{d.prospect_name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {d.view_count} views</span>
                    <span>· {new Date(d.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { navigator.clipboard.writeText(demoUrl(d.public_slug)); toast.success('Link copied') }} title="Copy link" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:text-ink"><Copy className="h-4 w-4" /></button>
                  <a href={demoUrl(d.public_slug)} target="_blank" rel="noreferrer" title="Open" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:text-ink"><ExternalLink className="h-4 w-4" /></a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
