'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, X, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export type KBEntry = { id: string; title: string; content: string }

export function KnowledgeBaseEditor({
  tenantId,
  agentId,
  initialEntries,
}: {
  tenantId: string
  agentId: string
  initialEntries: KBEntry[]
}) {
  const supabase = createClient()
  const [entries, setEntries] = useState<KBEntry[]>(initialEntries)
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' or an entry id
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: '', content: '' })
  const [saving, setSaving] = useState(false)

  function startAdd() {
    setEditingId('new')
    setDraft({ title: '', content: '' })
  }
  function startEdit(e: KBEntry) {
    setEditingId(e.id)
    setDraft({ title: e.title, content: e.content })
  }
  function cancel() {
    setEditingId(null)
    setDraft({ title: '', content: '' })
  }

  async function save() {
    if (!draft.title.trim() || !draft.content.trim()) { toast.error('Title and content are required'); return }
    setSaving(true)
    try {
      if (editingId === 'new') {
        const { data, error } = await supabase.from('knowledge_base')
          .insert({ tenant_id: tenantId, ai_employee_id: agentId, title: draft.title.trim(), content: draft.content.trim(), source: 'manual' })
          .select('id, title, content').single()
        if (error || !data) throw error
        setEntries((e) => [...e, data])
      } else {
        const { error } = await supabase.from('knowledge_base')
          .update({ title: draft.title.trim(), content: draft.content.trim() }).eq('id', editingId)
        if (error) throw error
        setEntries((e) => e.map((x) => (x.id === editingId ? { ...x, title: draft.title.trim(), content: draft.content.trim() } : x)))
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
    const { error } = await supabase.from('knowledge_base').delete().eq('id', id)
    if (error) { toast.error('Failed to delete'); return }
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
              <p className="text-sm font-semibold text-ink">{e.title}</p>
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
  draft: { title: string; content: string }
  setDraft: (d: { title: string; content: string }) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div className="border-2 border-[#5B6CF0]/40 rounded-lg p-3 space-y-2">
      <Input placeholder="Title (e.g. Pricing, Service Area)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <Textarea rows={3} placeholder="Details the AI should know…" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} loading={saving}><Check className="w-4 h-4 mr-1" /> Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
