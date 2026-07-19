'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Users, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionNav } from '@/components/commerce/section-nav'

interface Contact { id: string; name: string | null; phone: string | null; email: string | null; channel: string | null; total_conversations: number | null }

export function CustomerList() {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/core/contacts').then((r) => r.json()).then((d) => { if (live) setContacts(d.contacts ?? []) }).catch(() => { if (live) setContacts([]) })
    return () => { live = false }
  }, [])

  const filtered = useMemo(() => {
    if (!contacts) return []
    const s = q.trim().toLowerCase()
    return s ? contacts.filter((c) => [c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(s))) : contacts
  }, [contacts, q])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6"><h1 className="text-2xl font-light tracking-tight text-ink">Customers</h1><p className="mt-1 text-sm text-muted">Your contacts, with merge and activity history.</p></header>

      {contacts && contacts.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" className="h-11 w-full rounded-input border border-hairline bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none" />
        </div>
      )}

      {!contacts ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : contacts.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet">Contacts appear here automatically as conversations come in.</EmptyState>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No customers match “{q}”.</p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
          {filtered.map((c) => (
            <li key={c.id}>
              <Link href={`/commerce/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-medium text-accent-strong">{(c.name || '?').slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{c.name || 'Unknown'}</p>
                  <p className="truncate text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {!!c.total_conversations && <span className="shrink-0 text-xs text-muted">{c.total_conversations} conv.</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
