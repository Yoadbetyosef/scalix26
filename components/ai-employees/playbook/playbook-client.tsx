'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  type OwnerPlaybook,
  type PlaybookExample,
  type PlaybookStatus,
  PLAYBOOK_SECTIONS,
  emptyPlaybook,
} from '@/lib/playbook/types'
import { OwnerInterview } from './owner-interview'
import { SuggestionsQueue, type Suggestion } from './suggestions-queue'

type Tab = 'train' | 'playbook' | 'suggestions'

export function PlaybookClient({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [loading, setLoading] = useState(true)
  const [migrated, setMigrated] = useState(true)
  const [status, setStatus] = useState<PlaybookStatus>('none')
  const [playbook, setPlaybook] = useState<OwnerPlaybook | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [tab, setTab] = useState<Tab>('playbook')
  const [busy, setBusy] = useState<'' | 'generate' | 'save' | 'approve'>('')
  const [dirty, setDirty] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  // Reload from the API (used after applying a suggestion). setState happens only after
  // the awaits — safe to call from handlers.
  async function reload(switchTab = false) {
    const [pbRes, sugRes] = await Promise.all([
      fetch(`/api/playbook/${agentId}`).then((r) => r.json()),
      fetch(`/api/playbook/${agentId}/suggestions`).then((r) => r.json()).catch(() => ({ suggestions: [] })),
    ])
    setMigrated(pbRes.migrated !== false)
    setStatus(pbRes.status || 'none')
    setPlaybook(pbRes.playbook || null)
    setAnswers(pbRes.onboarding_answers || {})
    setSuggestions(sugRes.suggestions || [])
    if (switchTab) setTab(pbRes.playbook ? 'playbook' : 'train')
  }

  // Initial load. The fetch is async, so every setState lands after an await (never
  // synchronously inside the effect body).
  useEffect(() => {
    let active = true
    ;(async () => {
      const [pbRes, sugRes] = await Promise.all([
        fetch(`/api/playbook/${agentId}`).then((r) => r.json()),
        fetch(`/api/playbook/${agentId}/suggestions`).then((r) => r.json()).catch(() => ({ suggestions: [] })),
      ])
      if (!active) return
      setMigrated(pbRes.migrated !== false)
      setStatus(pbRes.status || 'none')
      setPlaybook(pbRes.playbook || null)
      setAnswers(pbRes.onboarding_answers || {})
      setSuggestions(sugRes.suggestions || [])
      setTab(pbRes.playbook ? 'playbook' : 'train')
      setLoading(false)
    })()
    return () => { active = false }
  }, [agentId])

  async function generate(fromAnswers?: Record<string, string>) {
    setBusy('generate')
    setBanner(null)
    try {
      if (fromAnswers) {
        await fetch(`/api/playbook/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboarding_answers: fromAnswers }),
        })
      }
      const r = await fetch(`/api/playbook/${agentId}`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Generation failed')
      setPlaybook(d.playbook)
      setStatus('draft')
      setDirty(false)
      setTab('playbook')
      setBanner('Draft playbook generated from your website, profile, and answers. Review and approve to go live.')
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy('')
    }
  }

  async function saveDraft() {
    if (!playbook) return
    setBusy('save')
    try {
      const r = await fetch(`/api/playbook/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbook }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Save failed') }
      setDirty(false)
      setBanner('Draft saved.')
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy('')
    }
  }

  async function approve() {
    if (!playbook) return
    setBusy('approve')
    try {
      const r = await fetch(`/api/playbook/${agentId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbook }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Approve failed')
      setStatus('approved')
      setDirty(false)
      setBanner(`${agentName} is now answering every channel using this playbook.`)
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusy('')
    }
  }

  const update = (next: OwnerPlaybook) => { setPlaybook(next); setDirty(true) }

  if (loading) return <div className="py-16 text-center text-sm text-muted">Loading {agentName}’s playbook…</div>

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-light tracking-tight text-ink">AI Training</h1>
        <p className="mt-1 text-sm text-subtle">
          Teach {agentName} how you sell, schedule, and handle customers — then she answers every channel like you would.
        </p>
      </header>

      {!migrated && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The playbook tables aren’t set up yet. Run <code className="font-mono">supabase/migrations/add_owner_playbook.sql</code> and
          <code className="font-mono"> add_playbook_suggestions.sql</code> in the Supabase SQL editor, then reload.
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-hairline">
        {([['playbook', 'Playbook'], ['train', 'Train'], ['suggestions', `Suggestions${suggestions.length ? ` (${suggestions.length})` : ''}`]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'relative px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {label}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
          </button>
        ))}
        <div className="ml-auto flex items-center pb-2">
          <StatusPill status={status} />
        </div>
      </div>

      {banner && (
        <div className="mb-4 rounded-xl bg-sunken px-4 py-3 text-sm text-subtle">{banner}</div>
      )}

      {tab === 'train' && (
        <OwnerInterview agentId={agentId} initial={answers} onDone={(a) => { setAnswers(a); generate(a) }} />
      )}

      {tab === 'suggestions' && (
        <SuggestionsQueue agentId={agentId} initial={suggestions} onApplied={() => reload()} />
      )}

      {tab === 'playbook' && (
        <div>
          {!playbook ? (
            <div className="rounded-2xl border border-dashed border-hairline-strong p-10 text-center">
              <p className="text-sm text-ink">No playbook yet.</p>
              <p className="mt-1 text-xs text-muted">Generate one from your website scan, profile, and onboarding answers.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button loading={busy === 'generate'} onClick={() => generate()}>Generate playbook</Button>
                <Button variant="outline" onClick={() => setTab('train')}>Answer interview first</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Button loading={busy === 'approve'} onClick={approve}>
                  {status === 'approved' ? 'Re-approve & update live' : 'Approve & go live'}
                </Button>
                <Button variant="outline" loading={busy === 'save'} disabled={!dirty} onClick={saveDraft}>
                  {dirty ? 'Save draft' : 'Saved'}
                </Button>
                <Button variant="ghost" loading={busy === 'generate'} onClick={() => generate()}>Regenerate</Button>
                <Button variant="ghost" onClick={() => setPlaybook(emptyPlaybook())}>Clear</Button>
              </div>

              <div className="space-y-4">
                {PLAYBOOK_SECTIONS.map((s) => (
                  <SectionCard
                    key={s.key as string}
                    label={s.label}
                    kind={s.kind}
                    value={playbook[s.key] as string | string[] | PlaybookExample[]}
                    onChange={(v) => update({ ...playbook, [s.key]: v } as OwnerPlaybook)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: PlaybookStatus }) {
  const map = {
    none: { t: 'Not set up', c: 'bg-sunken text-muted' },
    draft: { t: 'Draft — not live', c: 'bg-amber-100 text-amber-800' },
    approved: { t: 'Live on all channels', c: 'bg-emerald-100 text-emerald-800' },
  }[status]
  return <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', map.c)}>{map.t}</span>
}

function SectionCard({
  label,
  kind,
  value,
  onChange,
}: {
  label: string
  kind: 'text' | 'list' | 'examples'
  value: string | string[] | PlaybookExample[]
  onChange: (v: string | string[] | PlaybookExample[]) => void
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-e1 ring-1 ring-hairline">
      <h3 className="mb-2 text-sm font-medium text-ink">{label}</h3>
      {kind === 'text' && (
        <Textarea value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} className="min-h-[60px]" />
      )}
      {kind === 'list' && <ListEditor items={(value as string[]) || []} onChange={onChange} />}
      {kind === 'examples' && <ExamplesEditor items={(value as PlaybookExample[]) || []} onChange={onChange} />}
    </div>
  )
}

function ListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={it}
            onChange={(e) => { const next = [...items]; next[idx] = e.target.value; onChange(next) }}
          />
          <button onClick={() => onChange(items.filter((_, i) => i !== idx))} className="text-muted hover:text-danger" aria-label="Remove">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} className="text-xs font-medium text-subtle hover:text-ink">+ Add</button>
    </div>
  )
}

function ExamplesEditor({ items, onChange }: { items: PlaybookExample[]; onChange: (v: PlaybookExample[]) => void }) {
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={idx} className="rounded-xl bg-sunken p-3">
          <Input
            placeholder="Customer says…"
            value={it.customer}
            onChange={(e) => { const next = [...items]; next[idx] = { ...it, customer: e.target.value }; onChange(next) }}
          />
          <Input
            placeholder="Ideal reply…"
            value={it.reply}
            className="mt-2"
            onChange={(e) => { const next = [...items]; next[idx] = { ...it, reply: e.target.value }; onChange(next) }}
          />
          <button onClick={() => onChange(items.filter((_, i) => i !== idx))} className="mt-2 text-xs text-muted hover:text-danger">Remove</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { customer: '', reply: '' }])} className="text-xs font-medium text-subtle hover:text-ink">+ Add example</button>
    </div>
  )
}
