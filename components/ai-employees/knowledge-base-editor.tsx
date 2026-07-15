'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, X, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

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
    <div className="space-y-3">
      {entries.map((e) =>
        editingId === e.id ? (
          <EntryForm key={e.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} saving={saving} />
        ) : (
          <div key={e.id} className="border border-hairline rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{e.title}</p>
                <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${e.shared ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{e.shared ? 'Shared with all AI Employees' : 'Only this AI Employee'}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => startEdit(e)} className="text-muted hover:text-ink p-1"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(e.id)} className="text-muted hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <p className="text-xs text-subtle mt-1 whitespace-pre-wrap line-clamp-3">{e.content}</p>
          </div>
        ),
      )}

      {editingId === 'new' && <EntryForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} saving={saving} />}

      {editingId !== 'new' && (
        <Button variant="outline" size="sm" onClick={startAdd}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Entry
        </Button>
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
    <div className="border-2 border-[#5B6CF0]/40 rounded-lg p-3 space-y-2">
      <Input placeholder="Title (e.g. Pricing, Service Area)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <Textarea rows={3} placeholder="Details the AI should know…" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
      <div>
        <p className="text-xs font-medium text-muted mb-1">Who can use this?</p>
        <div className="inline-flex rounded-lg border border-hairline overflow-hidden text-xs">
          <button type="button" onClick={() => setDraft({ ...draft, shared: true })} className={`px-2.5 py-1.5 ${draft.shared ? 'bg-emerald-600 text-white' : 'text-muted hover:bg-hover'}`}>Shared with all AI Employees</button>
          <button type="button" onClick={() => setDraft({ ...draft, shared: false })} className={`px-2.5 py-1.5 border-l border-hairline ${!draft.shared ? 'bg-amber-600 text-white' : 'text-muted hover:bg-hover'}`}>Only this AI Employee</button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} loading={saving}><Check className="w-4 h-4 mr-1" /> Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
