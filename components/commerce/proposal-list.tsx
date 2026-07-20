'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { formatCents } from '@/lib/core/money-format'
import { toast } from 'sonner'

interface Row { id: string; legacy_type: 'proposal' | 'estimate' | 'quote'; number: string; status: string; currency: string; total_cents: number; created_at: string; expires_at: string | null }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', ready: 'pending', sent: 'open', viewed: 'open', accepted: 'active', declined: 'closed', expired: 'closed', converted: 'resolved', paid: 'active', rejected: 'closed', void: 'closed', unpaid: 'draft', partial: 'pending' }
const TYPE_LABEL: Record<Row['legacy_type'], string> = { proposal: 'Proposal', estimate: 'Estimate', quote: 'Quote' }
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString() } catch { return iso } }

export function ProposalList() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { fetch('/api/core/proposals').then((r) => r.json()).then((d) => setRows(d.proposals ?? [])).catch(() => setRows([])) }, [])

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
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-tight text-ink">Proposals</h1>
          <p className="mt-0.5 text-xs text-muted">One document from draft → sent → accepted → converted. Estimates &amp; quotes now live here too.</p>
        </div>
        <Button size="sm" loading={creating} onClick={create}><Plus className="h-4 w-4" /> New proposal</Button>
      </header>

      {!rows ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        : rows.length === 0 ? (
          <EmptyState icon={FileText} title="No proposals yet" action={<Button size="sm" onClick={create}><Plus className="h-4 w-4" /> New proposal</Button>}>
            Create a proposal, add products from your catalog, then send a branded page your customer can accept online.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2.5 font-medium">Number</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Total</th><th className="px-4 py-2.5 font-medium">Created</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.legacy_type}:${r.id}`} className="border-b border-hairline last:border-0 hover:bg-sunken/40">
                    <td className="px-4 py-2.5"><Link href={`/commerce/proposals/${r.id}`} className="font-medium text-ink hover:text-accent-strong">{r.number}</Link></td>
                    <td className="px-4 py-2.5">{r.legacy_type === 'proposal' ? <span className="text-muted">Proposal</span> : <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle" title="Legacy record, read-only">{TYPE_LABEL[r.legacy_type]}</span>}</td>
                    <td className="px-4 py-2.5"><Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                    <td className="px-4 py-2.5 text-ink">{formatCents(r.total_cents, r.currency)}</td>
                    <td className="px-4 py-2.5 text-muted">{when(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
