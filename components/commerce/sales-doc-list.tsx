'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionNav } from '@/components/commerce/section-nav'
import { formatCents } from '@/lib/core/money-format'
import type { DocType } from '@/lib/core/documents'
import { toast } from 'sonner'

interface Doc { id: string; number: string; status: string; currency: string; total_cents: number; source_document_type: string | null; created_at: string }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', sent: 'open', accepted: 'active', paid: 'active', rejected: 'closed', void: 'closed' }
const LABEL: Record<DocType, { one: string; many: string }> = { estimate: { one: 'estimate', many: 'Estimates' }, quote: { one: 'quote', many: 'Quotes' }, invoice: { one: 'invoice', many: 'Invoices' }, proposal: { one: 'proposal', many: 'Proposals' } }
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString() } catch { return iso } }

export function SalesDocList({ type }: { type: DocType }) {
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/core/documents/${type}`).then((r) => r.json()).then((d) => { if (live) setDocs(d.documents ?? []) }).catch(() => { if (live) setDocs([]) })
    return () => { live = false }
  }, [type])

  async function create() {
    setCreating(true)
    const res = await fetch('/api/core/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }) })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (res.ok && d.ok) router.push(`/commerce/${type}s/${d.document.id}`)
    else toast.error(d.error || `Could not create ${LABEL[type].one}.`)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-light tracking-tight text-ink">{LABEL[type].many}</h1>
        <Button onClick={create} loading={creating}><Plus className="h-4 w-4" /> New {LABEL[type].one}</Button>
      </header>

      {!docs ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileText} title={`No ${LABEL[type].many.toLowerCase()} yet`} action={<Button onClick={create} loading={creating}><Plus className="h-4 w-4" /> New {LABEL[type].one}</Button>}>
          Create a {LABEL[type].one} to add line items, take payment and convert it along the sales lifecycle.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-card border border-hairline bg-surface shadow-e1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Number</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-hairline last:border-0 hover:bg-sunken/60">
                  <td className="px-4 py-3"><Link href={`/commerce/${type}s/${d.id}`} className="font-medium text-ink hover:underline">{d.number}</Link>{d.source_document_type && <span className="ml-2 text-xs text-muted">from {d.source_document_type}</span>}</td>
                  <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[d.status] ?? 'neutral'}>{d.status}</Badge></td>
                  <td className="px-4 py-3 text-ink">{formatCents(d.total_cents, d.currency)}</td>
                  <td className="px-4 py-3 text-subtle">{when(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
