'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, FileText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { formatCents } from '@/lib/core/money-format'
import { toast } from 'sonner'

interface Row { id: string; legacy_type: 'proposal' | 'estimate' | 'quote'; number: string; title: string | null; status: string; customer_name: string | null; company_name: string | null; currency: string; total_cents: number; converted: boolean; updated_at: string }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', ready: 'pending', sent: 'open', viewed: 'open', accepted: 'active', declined: 'closed', expired: 'closed', converted: 'resolved', paid: 'active', rejected: 'closed', void: 'closed', unpaid: 'draft', partial: 'pending' }
const TYPE_LABEL: Record<Row['legacy_type'], string> = { proposal: 'Proposal', estimate: 'Estimate', quote: 'Quote' }
const STATUSES = ['draft', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted']
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString() } catch { return iso } }

export function ProposalList() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('')
  const [convertedF, setConvertedF] = useState('')

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('search', search.trim())
    if (statusF) p.set('status', statusF)
    if (convertedF) p.set('converted', convertedF)
    fetch(`/api/core/proposals?${p.toString()}`).then((r) => r.json()).then((d) => setRows(d.proposals ?? [])).catch(() => setRows([]))
  }, [search, statusF, convertedF])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  async function create() {
    setCreating(true)
    const res = await fetch('/api/core/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (res.ok && d.ok) router.push(`/commerce/proposals/${d.id}`)
    else toast.error(d.error || 'Could not create the proposal.')
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-tight text-ink">Proposals</h1>
          <p className="mt-0.5 text-xs text-muted">One document from draft → sent → accepted → converted. Estimates &amp; quotes live here too.</p>
        </div>
        <Button size="sm" loading={creating} onClick={create}><Plus className="h-4 w-4" /> New proposal</Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, number, customer, company, email…" className="pl-9" />
        </div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="h-11 rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={convertedF} onChange={(e) => setConvertedF(e.target.value)} className="h-11 rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">Any</option><option value="yes">Converted</option><option value="no">Not converted</option></select>
      </div>

      {!rows ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : rows.length === 0 ? (
          <EmptyState icon={FileText} title={search || statusF || convertedF ? 'No matches' : 'No proposals yet'} action={<Button size="sm" onClick={create}><Plus className="h-4 w-4" /> New proposal</Button>}>
            {search || statusF || convertedF ? 'Try a different search or filter.' : 'Create a proposal, add products, then send a branded page your customer can accept online.'}
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
            <ul className="divide-y divide-hairline">
              {rows.map((r) => (
                <li key={`${r.legacy_type}:${r.id}`}>
                  <Link href={`/commerce/proposals/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{r.title || r.number}</p>
                      <p className="truncate text-xs text-muted"><span className="font-mono">{r.number}</span>{r.customer_name && <> · {r.customer_name}</>}{r.company_name && <> · {r.company_name}</>}{r.legacy_type !== 'proposal' && <> · <span className="rounded bg-sunken px-1 text-[10px]">{TYPE_LABEL[r.legacy_type]}</span></>}</p>
                    </div>
                    {r.converted && <span className="hidden shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong sm:inline">Converted</span>}
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status}</Badge>
                    <span className="w-20 shrink-0 text-right text-sm text-ink">{formatCents(r.total_cents, r.currency)}</span>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-muted sm:inline">{when(r.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
    </div>
  )
}
