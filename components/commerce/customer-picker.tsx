'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Contact { id: string; name: string | null; phone: string | null; email: string | null }
interface Company { id: string; name: string }

// Searchable customer picker (contact + optional company). Reads only the active tenant's records, so a
// cross-tenant record can never be chosen. Keyboard-usable (native input + buttons).
export function CustomerPicker({ contactId, companyId, onClose, onSelect }: {
  contactId: string | null; companyId: string | null; onClose: () => void; onSelect: (v: { contactId: string | null; companyId: string | null }) => Promise<void>
}) {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(contactId)
  const [selCompany, setSelCompany] = useState<string | null>(companyId)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/core/contacts').then((r) => r.json()).then((d) => setContacts(d.contacts ?? [])).catch(() => setContacts([]))
    fetch('/api/core/companies').then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => setCompanies([]))
  }, [])

  const filtered = useMemo(() => {
    if (!contacts) return []
    const s = q.trim().toLowerCase()
    return (s ? contacts.filter((c) => [c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(s))) : contacts).slice(0, 50)
  }, [contacts, q])

  async function save(clear = false) {
    setSaving(true)
    await onSelect(clear ? { contactId: null, companyId: null } : { contactId: sel, companyId: selCompany })
    setSaving(false)
  }

  return (
    <Drawer open onClose={onClose} title="Choose customer"
      footer={<div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => save(true)}>Remove</Button>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} disabled={!sel} onClick={() => sel ? save() : toast.error('Pick a customer.')}>Save</Button></div>
      </div>}>
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" autoFocus className="h-11 w-full rounded-input border border-hairline bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none" />
        </div>
        {!contacts ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : filtered.length === 0 ? <p className="py-6 text-center text-sm text-muted">No customers found.</p> : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSel(c.id)} className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm', sel === c.id ? 'border-accent bg-accent/5' : 'border-hairline hover:bg-sunken')}>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{c.name || 'Unknown'}</span><span className="block truncate text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span></span>
                    {sel === c.id && <Check className="h-4 w-4 shrink-0 text-accent-strong" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        {companies.length > 0 && (
          <div className="space-y-1.5 border-t border-hairline pt-3">
            <label className="text-xs font-medium text-muted">Company (optional)</label>
            <select value={selCompany ?? ''} onChange={(e) => setSelCompany(e.target.value || null)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
              <option value="">— none —</option>
              {companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
            </select>
          </div>
        )}
      </div>
    </Drawer>
  )
}
