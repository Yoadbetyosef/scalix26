import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listMemos } from '@/lib/memos/store'
import { MEMO_KIND_LABELS, isMemoSettled, memoOverdue, memoStatusLabel, MEMOS_MIGRATION_HINT } from '@/lib/memos/labels'

export const dynamic = 'force-dynamic'
const money = (c: number | null, cur: string) => c == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 0 }).format(c / 100)

// Pieces in someone else's hands, and someone else's pieces in ours. Open memos first, the overdue
// ones flagged; the settled ones underneath, because the history is the point — "you had that
// sapphire out on memo in March" is the memory this list keeps for her.
export default async function MemosPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const { memos, missing } = await listMemos()
  const view = (await searchParams).view === 'all' ? 'all' : 'open'
  const shown = view === 'open' ? memos.filter((m) => !isMemoSettled(m.status)) : memos
  const open = memos.filter((m) => !isMemoSettled(m.status)).length

  return (
    <div className="v2 v2-embedded mx-auto max-w-5xl p-4 sm:p-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Memos &amp; consignment · {shown.length}</p>
        <s />
        <Link href="/orders" className="v2-act">Orders</Link>
        <Link href="/orders/memos/new" className="v2-act" data-solid>New memo</Link>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        <Link href="/orders/memos" className="v2-chip" data-on={view === 'open' || undefined}>Open <span style={{ opacity: 0.6 }}>{open}</span></Link>
        <Link href="/orders/memos?view=all" className="v2-chip" data-on={view === 'all' || undefined}>All <span style={{ opacity: 0.6 }}>{memos.length}</span></Link>
      </div>

      {missing && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginBottom: 16 }}><p>{MEMOS_MIGRATION_HINT}</p></div>
      )}

      {shown.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>{view === 'open' ? 'Nothing out on memo' : 'No memos yet'}</b>
          <span>Send a stock piece out to a customer or dealer, or record a supplier&apos;s piece received on memo or consignment. Stock follows automatically.</span>
        </div>
      ) : (
        <div className="v2-list">
          {shown.map((m) => {
            const overdue = memoOverdue(m)
            return (
              <Link key={m.id} href={`/orders/memos/${m.id}`} className="v2-row tap-target" data-click
                    style={{ ['--chan' as string]: overdue ? 'var(--v2-t4)' : isMemoSettled(m.status) ? 'var(--v2-mute)' : m.direction === 'out' ? 'var(--v2-t3)' : 'var(--v2-t1)' }}>
                <div className="v2-m">
                  <p className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="truncate">{m.itemDescription}</span>
                    <span className="v2-stat">{memoStatusLabel(m.status, m.direction, m.kind)}</span>
                    {overdue && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>Follow up overdue</span>}
                  </p>
                  <span>
                    {m.direction === 'out' ? 'With' : 'From'} {m.counterpartyName ?? '—'} · {MEMO_KIND_LABELS[m.kind]} · {m.quantity > 1 ? `${m.quantity} × ` : ''}{money(m.agreedPriceCents, m.currency)}
                  </span>
                </div>
                <div className="v2-meta">
                  <em>{m.direction === 'out' ? 'Sent' : 'Received'} {m.movedOn}</em>
                  {m.dueOn && !isMemoSettled(m.status) && <em>Follow up {m.dueOn}</em>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
