'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Panel } from '@/components/partner/ui'
import { ExternalLink } from 'lucide-react'

export function MarketplaceEditor({ canEdit, slug }: { canEdit: boolean; slug: string }) {
  const [f, setF] = useState({ headline: '', bio: '', website: '', logo_url: '', specialties: '', regions: '', languages: '', countries: '', response_time: '', projects_completed: '', listed: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/partner/marketplace/profile').then((r) => r.json()).then((j) => {
      const p = j.profile
      if (p) setF({
        headline: p.headline || '', bio: p.bio || '', website: p.website || '', logo_url: p.logo_url || '',
        specialties: (p.specialties || []).join(', '), regions: (p.regions || []).join(', '), languages: (p.languages || []).join(', '),
        countries: (p.countries || []).join(', '), response_time: p.response_time || '', projects_completed: p.projects_completed ? String(p.projects_completed) : '', listed: !!p.listed,
      })
      setLoading(false)
    })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const res = await fetch('/api/partner/marketplace/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
    setBusy(false)
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Profile saved')
  }

  const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
  if (loading) return <div className="rounded-xl border border-hairline bg-surface p-10 text-center text-sm text-muted">Loading…</div>

  return (
    <form onSubmit={save} className="space-y-4">
      <Panel title="Public profile" action={f.listed && <a href={`${origin}/marketplace/${slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-strong hover:underline">View <ExternalLink className="h-3 w-3" /></a>}>
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Headline</label><input disabled={!canEdit} className={input} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="AI automation for local service businesses" /></div>
          <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Bio</label><textarea disabled={!canEdit} rows={3} className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Website</label><input disabled={!canEdit} className={input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Logo URL</label><input disabled={!canEdit} className={input} value={f.logo_url} onChange={(e) => setF({ ...f, logo_url: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Specialties (comma-sep)</label><input disabled={!canEdit} className={input} value={f.specialties} onChange={(e) => setF({ ...f, specialties: e.target.value })} placeholder="HVAC, Locksmith, Salons" /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Regions</label><input disabled={!canEdit} className={input} value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} placeholder="US, Canada" /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Languages</label><input disabled={!canEdit} className={input} value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} placeholder="English, Spanish" /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Countries</label><input disabled={!canEdit} className={input} value={f.countries} onChange={(e) => setF({ ...f, countries: e.target.value })} placeholder="US, Canada, UK" /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Response time</label><input disabled={!canEdit} className={input} value={f.response_time} onChange={(e) => setF({ ...f, response_time: e.target.value })} placeholder="Within an hour" /></div>
            <div><label className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Projects completed</label><input type="number" disabled={!canEdit} className={input} value={f.projects_completed} onChange={(e) => setF({ ...f, projects_completed: e.target.value })} placeholder="0" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" disabled={!canEdit} checked={f.listed} onChange={(e) => setF({ ...f, listed: e.target.checked })} className="h-4 w-4" />
            List my profile publicly in the partner directory
          </label>
        </div>
      </Panel>
      {canEdit && <button disabled={busy} className="h-11 rounded-lg bg-ink px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button>}
    </form>
  )
}
