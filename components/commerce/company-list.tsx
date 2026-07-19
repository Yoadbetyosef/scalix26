'use client'

import { useEffect, useState } from 'react'
import { Building2, Plus, Pencil, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { SectionNav } from '@/components/commerce/section-nav'
import { toast } from 'sonner'

interface Company { id: string; name: string; domain: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null }

export function CompanyList() {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [editing, setEditing] = useState<Company | 'new' | null>(null)

  const load = () => fetch('/api/core/companies').then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => setCompanies([]))
  useEffect(() => { load() }, [])

  async function archive(c: Company) {
    const res = await fetch(`/api/core/companies/${c.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Company archived.'); load() } else toast.error('Could not archive.')
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-light tracking-tight text-ink">Companies</h1>
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New company</Button>
      </header>

      {!companies ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" action={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New company</Button>}>Group contacts under the businesses they belong to.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {companies.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-e1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-strong"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{c.name}</p><p className="truncate text-xs text-muted">{[c.domain, c.email, c.phone].filter(Boolean).join(' · ') || '—'}</p></div>
              <button onClick={() => setEditing(c)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => archive(c)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-danger" aria-label="Archive"><Archive className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {editing && <CompanyForm company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
    </div>
  )
}

function CompanyForm({ company, onClose, onDone }: { company: Company | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: company?.name ?? '', domain: company?.domain ?? '', email: company?.email ?? '', phone: company?.phone ?? '', address: company?.address ?? '', notes: company?.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }))

  async function save() {
    if (!v.name.trim()) { toast.error('Name is required.'); return }
    setSaving(true)
    const payload = { name: v.name.trim(), domain: v.domain.trim() || null, email: v.email.trim() || null, phone: v.phone.trim() || null, address: v.address.trim() || null, notes: v.notes.trim() || null }
    const res = company
      ? await fetch(`/api/core/companies/${company.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/core/companies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && (d.company || d.ok !== false)) { toast.success(company ? 'Company saved.' : 'Company created.'); onDone() } else toast.error(d.error || 'Could not save the company.')
  }

  return (
    <Drawer open onClose={onClose} title={company ? 'Edit company' : 'New company'} footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>{company ? 'Save' : 'Create'}</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={300} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Domain</Label><Input value={v.domain} onChange={(e) => set('domain', e.target.value)} placeholder="example.com" maxLength={300} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} /></div>
        </div>
        <div className="space-y-1.5"><Label>Email</Label><Input value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={320} /></div>
        <div className="space-y-1.5"><Label>Address</Label><Input value={v.address} onChange={(e) => set('address', e.target.value)} maxLength={1000} /></div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLength={5000} /></div>
      </div>
    </Drawer>
  )
}
