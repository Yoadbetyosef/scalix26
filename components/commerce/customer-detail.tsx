'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Archive, RotateCcw, GitMerge, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface Contact { id: string; name: string | null; phone: string | null; email: string | null; notes: string | null; archived_at: string | null }
interface Dup { id: string; name: string | null; score?: number; reasons?: string[] }
interface Act { id: string; type: string; title: string | null; body: string | null; occurred_at: string }
const when = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export function CustomerDetail({ id }: { id: string }) {
  const [contact, setContact] = useState<Contact | null | 'notfound'>(null)
  const [dups, setDups] = useState<Dup[]>([])
  const [acts, setActs] = useState<Act[]>([])
  const [mergeLoser, setMergeLoser] = useState<Dup | null>(null)
  const [addingNote, setAddingNote] = useState(false)
  const [edit, setEdit] = useState<{ name: string; phone: string; email: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const loadContact = () => fetch(`/api/core/contacts/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('404')))).then((d) => setContact(d.contact)).catch(() => setContact('notfound'))
  const loadDups = () => fetch(`/api/core/contacts/${id}/duplicates`).then((r) => r.json()).then((d) => setDups(d.duplicates ?? [])).catch(() => setDups([]))
  const loadActs = () => fetch(`/api/core/contacts/${id}/activities`).then((r) => r.json()).then((d) => setActs(d.activities ?? [])).catch(() => setActs([]))
  useEffect(() => { loadContact(); loadDups(); loadActs() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdit() {
    if (!edit) return
    if (!edit.name.trim()) { toast.error('Name is required.'); return }
    setSavingEdit(true)
    const res = await fetch(`/api/core/contacts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: edit.name.trim(), phone: edit.phone.trim() || null, email: edit.email.trim() || null }) })
    setSavingEdit(false)
    if (res.ok) { toast.success('Customer updated.'); setEdit(null); loadContact() } else toast.error('Could not save.')
  }

  async function toggleArchive(archived: boolean) {
    const res = await fetch(`/api/core/contacts/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived }) })
    if (res.ok) { toast.success(archived ? 'Customer archived.' : 'Customer restored.'); loadContact() } else toast.error('Could not update.')
  }

  async function doMerge() {
    if (!mergeLoser) return
    const res = await fetch(`/api/core/contacts/${id}/merge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loserId: mergeLoser.id }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) {
      const moved = d.moved ? Object.entries(d.moved).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${n} ${k}`).join(', ') : ''
      toast.success(`Merged. ${moved ? 'Moved ' + moved + '.' : ''}`)
      setMergeLoser(null); loadDups(); loadActs()
    } else toast.error(d.error || 'Merge failed.')
  }

  async function addNote(body: string) {
    const res = await fetch(`/api/core/contacts/${id}/activities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'note', body }) })
    if (res.ok) { toast.success('Note added.'); setAddingNote(false); loadActs() } else toast.error('Could not add note.')
  }

  if (contact === 'notfound') return <div className="mx-auto max-w-2xl px-4 py-10 text-center text-sm text-muted">Customer not found.</div>

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <Link href="/commerce/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> Customers</Link>

      {!contact ? <Skeleton className="mb-6 h-16 w-full" /> : (
        <>
          <header className="mb-5 flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-lg font-medium text-accent-strong">{(contact.name || '?').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-light tracking-tight text-ink">{contact.name || 'Unknown'}</h1><p className="truncate text-xs text-muted">{[contact.phone, contact.email].filter(Boolean).join(' · ') || '—'}</p></div>
            {contact.archived_at && <Badge variant="closed">Archived</Badge>}
          </header>

          <div className="mb-5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdit({ name: contact.name ?? '', phone: contact.phone ?? '', email: contact.email ?? '' })}>Edit details</Button>
            {contact.archived_at
              ? <Button size="sm" variant="outline" onClick={() => toggleArchive(false)}><RotateCcw className="h-4 w-4" /> Restore</Button>
              : <Button size="sm" variant="outline" onClick={() => toggleArchive(true)}><Archive className="h-4 w-4" /> Archive</Button>}
          </div>

          {/* Possible duplicates → merge */}
          {dups.length > 0 && (
            <section className="mb-5 rounded-card border border-warning/30 bg-warning/5 p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><GitMerge className="h-4 w-4" /> Possible duplicates</h2>
              <ul className="space-y-2">
                {dups.map((dp) => (
                  <li key={dp.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm shadow-e1">
                    <div className="min-w-0"><span className="font-medium text-ink">{dp.name || 'Unknown'}</span>{dp.reasons?.length ? <span className="ml-2 text-xs text-muted">{dp.reasons.join(', ')}</span> : null}</div>
                    <Button size="sm" variant="outline" onClick={() => setMergeLoser(dp)}>Merge in</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Activity */}
          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium text-ink">Activity</h2><Button size="sm" variant="ghost" onClick={() => setAddingNote(true)}><Plus className="h-4 w-4" /> Add note</Button></div>
            {acts.length === 0 ? <p className="py-6 text-center text-sm text-muted">No activity yet.</p> : (
              <ul className="space-y-4">
                {acts.map((a) => (
                  <li key={a.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" /><div className="min-w-0"><p className="text-sm text-ink">{a.title || a.type}</p>{a.body && <p className="mt-0.5 text-sm text-subtle">{a.body}</p>}<p className="mt-0.5 text-xs text-muted">{when(a.occurred_at)}</p></div></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Edit drawer */}
      {edit && (
        <Drawer open onClose={() => setEdit(null)} title="Edit customer" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" loading={savingEdit} onClick={saveEdit}>Save</Button></div>}>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={300} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} maxLength={50} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} maxLength={320} /></div>
          </div>
        </Drawer>
      )}

      {/* Merge confirm */}
      {mergeLoser && contact && (
        <Drawer open onClose={() => setMergeLoser(null)} title="Merge customers" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setMergeLoser(null)}>Cancel</Button><Button size="sm" onClick={doMerge}>Confirm merge</Button></div>}>
          <div className="space-y-4 text-sm">
            <div className="rounded-card border border-hairline p-3"><p className="text-xs uppercase tracking-wide text-muted">Keep (winner)</p><p className="font-medium text-ink">{contact.name || 'Unknown'}</p></div>
            <div className="rounded-card border border-hairline p-3"><p className="text-xs uppercase tracking-wide text-muted">Merge in (loser)</p><p className="font-medium text-ink">{mergeLoser.name || 'Unknown'}</p></div>
            <p className="text-subtle">All of <strong>{mergeLoser.name || 'this contact'}</strong>’s conversations, activities, appointments, leads, channel identities and company links move to <strong>{contact.name || 'the winner'}</strong>. The merged customer is <strong>archived, not deleted</strong>, and the merge is recorded on the timeline.</p>
          </div>
        </Drawer>
      )}

      {addingNote && <NoteForm onClose={() => setAddingNote(false)} onSave={addNote} />}
    </div>
  )
}

function NoteForm({ onClose, onSave }: { onClose: () => void; onSave: (body: string) => void }) {
  const [body, setBody] = useState('')
  return (
    <Drawer open onClose={onClose} title="Add note" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => body.trim() ? onSave(body.trim()) : toast.error('Note is empty.')}>Add</Button></div>}>
      <div className="space-y-1.5"><Label>Note</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={10000} placeholder="Write a note…" /></div>
    </Drawer>
  )
}
