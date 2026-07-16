import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listDrafts } from '@/lib/commerce/drafts'
import { NewDraftButton } from '@/components/commerce/new-draft-button'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const STATUS: Record<string, string> = { working: 'bg-gray-100 text-gray-700', ready_for_review: 'bg-amber-100 text-amber-700', sent_to_customer: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700', converted: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500' }

export default async function DraftsPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const drafts = await listDrafts()
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-gray-900">Drafts</h1><p className="text-sm text-gray-500">{drafts.length} draft{drafts.length === 1 ? '' : 's'}</p></div>
        <NewDraftButton />
      </div>
      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No drafts yet. Start a proposal for a customer.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {drafts.map((d) => (
            <Link key={d.id as string} href={`/commerce/drafts/${d.id}`} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
              <span className="font-mono text-xs text-gray-500">{d.draft_number as string}</span>
              <span className="text-gray-900">{(d.name as string) || (d.customer_name as string) || 'Untitled'}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[d.status as string] ?? 'bg-gray-100 text-gray-600'}`}>{(d.status as string).replace(/_/g, ' ')}</span>
              <span className="ml-auto tabular-nums text-gray-900">{money(Number(d.total_cents), d.currency as string)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
