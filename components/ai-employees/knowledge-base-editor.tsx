'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, X, Check } from 'lucide-react'
import { GlassChoice } from '@/app/(v2)/v2/controls'

export type KBEntry = { id: string; title: string; content: string; shared: boolean }
type Draft = { title: string; content: string; shared: boolean }

export function KnowledgeBaseEditor({
  agentId,
  initialEntries,
}: {
  tenantId?: string
  agentId: string
  initialEntries: KBEntry[]
}) {
  const [entries, setEntries] = useState<KBEntry[]>(initialEntries)
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' or an entry id
  const [draft, setDraft] = useState<Draft>({ title: '', content: '', shared: true })
  const [saving, setSaving] = useState(false)

  function startAdd() {
    setEditingId('new')
    setDraft({ title: '', content: '', shared: true }) // new knowledge defaults to shared
  }
  function startEdit(e: KBEntry) {
    setEditingId(e.id)
    setDraft({ title: e.title, content: e.content, shared: e.shared })
  }
  function cancel() {
    setEditingId(null)
    setDraft({ title: '', content: '', shared: true })
  }

  async function save() {
    if (!draft.title.trim() || !draft.content.trim()) { toast.error('Title and content are required'); return }
    setSaving(true)
    try {
      // Server APIs scope the write to the validated active business (owner or operated client).
      if (editingId === 'new') {
        const res = await fetch(`/api/agents/${agentId}/knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: draft.title.trim(), content: draft.content.trim(), shared: draft.shared }) })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.entry) throw new Error('failed')
        setEntries((e) => [...e, j.entry])
      } else {
        const res = await fetch(`/api/agents/${agentId}/knowledge`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: editingId, title: draft.title.trim(), content: draft.content.trim(), shared: draft.shared }) })
        if (!res.ok) throw new Error('failed')
        setEntries((e) => e.map((x) => (x.id === editingId ? { ...x, title: draft.title.trim(), content: draft.content.trim(), shared: draft.shared } : x)))
      }
      toast.success('Saved')
      cancel()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this entry?')) return
    const res = await fetch(`/api/agents/${agentId}/knowledge?entryId=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Failed to delete'); return }
    setEntries((e) => e.filter((x) => x.id !== id))
  }

  return (
    <div>
      {entries.map((e) =>
        editingId === e.id ? (
          <EntryForm key={e.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} saving={saving} />
        ) : (
          <div key={e.id} className="v2-grow" data-static>
            <span className="v2-glab">
              <b style={{ fontWeight: 550 }}>{e.title}</b>
              {/* Scope is the one fact about an entry that changes what it does, so it is the one
                  thing on the row that carries a hue: violet for shared across every employee,
                  mute for this one only. */}
              <span className="v2-stat" style={{ ['--chan' as string]: e.shared ? 'var(--v2-t3)' : 'var(--v2-mute)', marginLeft: 8 }}>
                {e.shared ? 'All AI employees' : 'This one only'}
              </span>
              <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, lineHeight: 1.45, color: 'var(--v2-ink-45)', whiteSpace: 'pre-wrap' }}>{e.content}</span>
            </span>
            <span className="v2-gtrail">
              <button onClick={() => startEdit(e)} className="v2-ico" aria-label={`Edit ${e.title}`}><Pencil /></button>
              <button onClick={() => remove(e.id)} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} aria-label={`Delete ${e.title}`}><X /></button>
            </span>
          </div>
        ),
      )}

      {editingId === 'new' && <EntryForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} saving={saving} />}

      {editingId !== 'new' && (
        <div className="v2-bar" style={{ marginTop: 14 }}>
          <button onClick={startAdd} className="v2-act tap-target"><Plus className="w-3.5 h-3.5" /> Add entry</button>
        </div>
      )}
    </div>
  )
}

function EntryForm({
  draft, setDraft, onSave, onCancel, saving,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div style={{ padding: '14px 0' }}>
      <div className="v2-fld" style={{ marginBottom: 18 }}>
        <label htmlFor="kb-title">Title</label>
        <input id="kb-title" placeholder="e.g. Pricing, Service area" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </div>
      <div className="v2-fld" style={{ marginBottom: 18 }}>
        <label htmlFor="kb-content">Details the AI should know</label>
        <textarea id="kb-content" rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
      </div>
      {/* Two mutually exclusive options, in the kit's choice control — v1 used a segmented pair
          filled emerald and amber, which read as good-and-warning rather than as two scopes. */}
      <GlassChoice
        label="Who can use this?"
        value={draft.shared ? 'all' : 'one'}
        onChange={(v) => setDraft({ ...draft, shared: v === 'all' })}
        options={[
          { value: 'all', label: 'All AI employees', hint: 'Every employee can quote it.' },
          { value: 'one', label: 'Only this one', hint: 'Nobody else sees it.' },
        ]}
      />
      <div className="v2-bar" style={{ marginTop: 18 }}>
        <button onClick={onSave} disabled={saving} className="v2-act tap-target" data-solid><Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="v2-act tap-target">Cancel</button>
      </div>
    </div>
  )
}
