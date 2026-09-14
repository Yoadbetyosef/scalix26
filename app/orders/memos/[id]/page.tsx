import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getMemo } from '@/lib/memos/store'
import { MEMO_KIND_LABELS, memoOverdue, memoStatusLabel, isMemoSettled } from '@/lib/memos/types'
import { MemoActions } from '@/components/memos/memo-actions'
import { actorLabels, actorLabel } from '@/lib/orders/actors'

export const dynamic = 'force-dynamic'
const money = (c: number | null, cur: string) => c == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 2 }).format(c / 100)

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const m = await getMemo((await params).id)
  if (!m) notFound()
  const { memo, events } = m
  const labels = await actorLabels(events.map((e) => e.actor))
  const overdue = memoOverdue(memo)

  return (
    <div className="v2 v2-embedded mx-auto max-w-4xl p-4 sm:p-6">
      <div className="v2-head" style={{ alignItems: 'center', marginBottom: 16 }}>
        <Link href="/orders/memos" className="v2-ico tap-target" aria-label="Back to memos"><ArrowLeft /></Link>
        <div className="min-w-0" style={{ flex: 1 }}>
          <p className="v2-kick">{MEMO_KIND_LABELS[memo.kind]} · {memo.direction === 'out' ? 'our piece, out' : 'their piece, in'}</p>
          <h1 className="truncate" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--v2-ink)', marginTop: 2 }}>{memo.itemDescription}</h1>
        </div>
        <span className="v2-stat" style={{ ['--chan' as string]: isMemoSettled(memo.status) ? 'var(--v2-mute)' : 'var(--v2-t3)' }}>{memoStatusLabel(memo.status, memo.direction, memo.kind)}</span>
        {overdue && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>Follow up overdue</span>}
      </div>

      <div className="v2-bar" style={{ marginBottom: 24 }}>
        <MemoActions memo={memo} />
        {memo.orderId && <Link href={`/orders/${memo.orderId}`} className="v2-act">Order ↗</Link>}
        {memo.contactId && <Link href={`/contacts/${memo.contactId}`} className="v2-act">Customer ↗</Link>}
        {memo.catalogProductId && <Link href={`/catalog/${memo.catalogProductId}`} className="v2-act">Stock item ↗</Link>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Details</p><s /></div>
          <dl className="v2-facts" data-narrow>
            <div><dt>{memo.direction === 'out' ? 'With' : 'From'}</dt><dd>{memo.counterpartyName ?? '—'}</dd></div>
            <div><dt>Owner</dt><dd>{memo.owner === 'company' ? 'Us — it stays our stock' : `${memo.counterpartyName ?? 'Supplier'} — never our stock`}</dd></div>
            <div><dt>Quantity</dt><dd>{memo.quantity}</dd></div>
            <div><dt>{memo.direction === 'out' ? 'Sent on' : 'Received on'}</dt><dd>{memo.movedOn}</dd></div>
            <div><dt>Follow up by</dt><dd>{memo.dueOn ?? '—'}</dd></div>
            {memo.soldOn && <div><dt>Sold on</dt><dd>{memo.soldOn}</dd></div>}
            {memo.returnedOn && <div><dt>Returned on</dt><dd>{memo.returnedOn}</dd></div>}
          </dl>
        </section>
        <section>
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Money</p><s /></div>
          <dl className="v2-facts" data-narrow>
            <div><dt>{memo.direction === 'out' ? 'Agreed price' : 'Selling price'}</dt><dd>{money(memo.agreedPriceCents, memo.currency)}</dd></div>
            <div><dt>{memo.direction === 'out' ? 'Our cost' : 'Owed to supplier if sold'}</dt><dd>{money(memo.costCents, memo.currency)}</dd></div>
            {memo.soldPriceCents != null && <div><dt>Sold for</dt><dd>{money(memo.soldPriceCents, memo.currency)}</dd></div>}
            {memo.direction === 'in' && memo.status === 'sold' && <div><dt>Supplier settled</dt><dd>{memo.settledAt ? new Date(memo.settledAt).toLocaleDateString() : 'Not yet'}</dd></div>}
          </dl>
          {memo.notes && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--v2-ink)', marginTop: 12 }}>{memo.notes}</p>}
        </section>
      </div>

      <section style={{ marginTop: 24 }}>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />History · {events.length}</p><s /></div>
        <ul className="space-y-2.5">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 text-sm">
              <span style={{ marginTop: 7, width: 5, height: 5, flex: 'none', borderRadius: '50%', background: 'var(--v2-line-strong)' }} />
              <div>
                <span style={{ color: 'var(--v2-ink)' }}>
                  {e.type === 'created' ? 'Memo opened' : e.type === 'settled' ? 'Supplier paid' : `${String(e.payload?.from ?? '').replace('_', ' ')} → ${String(e.payload?.to ?? '').replace('_', ' ')}`}
                </span>
                {e.payload?.note ? <span style={{ color: 'var(--v2-mute)' }}> — {String(e.payload.note)}</span> : null}
                <p className="v2-kick" style={{ marginTop: 2 }}>{new Date(e.createdAt).toLocaleString()} · {actorLabel(labels, e.actor)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
