'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, X } from 'lucide-react'
import { StatusPill } from '@/app/(v2)/v2/controls'
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

  if (loading) return <p className="v2-kick" style={{ padding: '40px 0' }}>Loading {agentName}’s playbook…</p>

  return (
    <div>
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />AI training</p><s />
      </div>
      <p className="v2-hint" style={{ maxWidth: '62ch', marginBottom: 22 }}>
        Teach {agentName} how you sell, schedule and handle customers — then she answers every channel like you would.
      </p>

      {!migrated && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', marginBottom: 20 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            The playbook tables are not set up yet.
            <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              Run <code className="v2-mono">supabase/migrations/add_owner_playbook.sql</code> and{' '}
              <code className="v2-mono">add_playbook_suggestions.sql</code> in the Supabase SQL editor, then reload.
            </span>
          </p>
        </div>
      )}

      {/* THE TABS, in the approved form: the mono micro-label used as a control, with a gradient
          underline on the selected one. v1 marked it with a solid ink bar and a heavier weight —
          two signals for one state, in a vocabulary the rail already owns. */}
      <div className="v2-tabs" style={{ marginBottom: 22 }}>
        {([['playbook', 'Playbook'], ['train', 'Train'], ['suggestions', `Suggestions${suggestions.length ? ` · ${suggestions.length}` : ''}`]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className="v2-tab" data-on={tab === t || undefined}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ paddingBottom: 9 }}><PlaybookStatusPill status={status} /></span>
      </div>

      {banner && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t3)', marginBottom: 18 }}>
          <span className="v2-chip-sq"><Check /></span>
          <p>{banner}</p>
        </div>
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
            <div className="v2-card" data-empty>
              <b>No playbook yet</b>
              <span>Generate one from your website scan, your profile and your onboarding answers — or answer the interview first and generate from that.</span>
              <span className="v2-bar" style={{ marginTop: 8 }}>
                <button disabled={busy === 'generate'} onClick={() => generate()} className="v2-act tap-target" data-solid>
                  {busy === 'generate' ? 'Generating…' : 'Generate playbook'}
                </button>
                <button onClick={() => setTab('train')} className="v2-act tap-target">Answer interview first</button>
              </span>
            </div>
          ) : (
            <>
              {/* The separator marks where reversible stops: approving publishes this to every
                  channel, and Clear empties the whole playbook. */}
              <div className="v2-bar" style={{ marginBottom: 22 }}>
                <button disabled={busy === 'approve'} onClick={approve} className="v2-act tap-target" data-solid>
                  {busy === 'approve' ? 'Approving…' : status === 'approved' ? 'Re-approve & update live' : 'Approve & go live'}
                </button>
                <button disabled={busy === 'save' || !dirty} onClick={saveDraft} className="v2-act tap-target">
                  {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                </button>
                <button disabled={busy === 'generate'} onClick={() => generate()} className="v2-act tap-target">
                  {busy === 'generate' ? 'Generating…' : 'Regenerate'}
                </button>
                <hr />
                <button onClick={() => setPlaybook(emptyPlaybook())} className="v2-act tap-target" data-danger>Clear</button>
              </div>

              <div style={{ display: 'grid', gap: 26 }}>
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

function PlaybookStatusPill({ status }: { status: PlaybookStatus }) {
  // 'none' is not a state worth a pill — nothing has gone wrong and nothing is live; the empty state
  // below already says so. Draft is the one that needs a person, so it is the one that carries amber.
  if (status === 'none') return <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>Not set up</span>
  return <StatusPill state={status === 'approved' ? 'live' : 'pending'}>
    {status === 'approved' ? 'Live on all channels' : 'Draft — not live'}
  </StatusPill>
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
    <section>
      <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />{label}</p><s /></div>
      {kind === 'text' && (
        <div className="v2-fld">
          <label htmlFor={`pb-${label}`}>What to say</label>
          <textarea id={`pb-${label}`} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} rows={3} />
        </div>
      )}
      {kind === 'list' && <ListEditor items={(value as string[]) || []} onChange={onChange} label={label} />}
      {kind === 'examples' && <ExamplesEditor items={(value as PlaybookExample[]) || []} onChange={onChange} />}
    </section>
  )
}

function ListEditor({ items, onChange, label }: { items: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={`pb-${label}-${idx}`}>Line {idx + 1}</label>
            <input
              id={`pb-${label}-${idx}`}
              value={it}
              onChange={(e) => { const next = [...items]; next[idx] = e.target.value; onChange(next) }}
            />
          </div>
          <button onClick={() => onChange(items.filter((_, i) => i !== idx))} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} aria-label={`Remove line ${idx + 1}`}><X /></button>
        </div>
      ))}
      <div className="v2-bar">
        <button onClick={() => onChange([...items, ''])} className="v2-act tap-target"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>
    </div>
  )
}

function ExamplesEditor({ items, onChange }: { items: PlaybookExample[]; onChange: (v: PlaybookExample[]) => void }) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div className="v2-form" style={{ flex: 1, minWidth: 0, gap: '14px 26px' }}>
            <div className="v2-fld wide">
              <label htmlFor={`pb-ex-${idx}-c`}>Customer says</label>
              <input id={`pb-ex-${idx}-c`} value={it.customer}
                onChange={(e) => { const next = [...items]; next[idx] = { ...it, customer: e.target.value }; onChange(next) }} />
            </div>
            <div className="v2-fld wide">
              <label htmlFor={`pb-ex-${idx}-r`}>Ideal reply</label>
              <input id={`pb-ex-${idx}-r`} value={it.reply}
                onChange={(e) => { const next = [...items]; next[idx] = { ...it, reply: e.target.value }; onChange(next) }} />
            </div>
          </div>
          <button onClick={() => onChange(items.filter((_, i) => i !== idx))} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)', marginTop: 20 }} aria-label={`Remove example ${idx + 1}`}><X /></button>
        </div>
      ))}
      <div className="v2-bar">
        <button onClick={() => onChange([...items, { customer: '', reply: '' }])} className="v2-act tap-target"><Plus className="w-3.5 h-3.5" /> Add example</button>
      </div>
    </div>
  )
}
