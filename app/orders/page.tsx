import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { STAGE_LABELS, orderStatusGroup, type OrderStage } from '@/lib/orders/stages'
import { stageHue } from '@/lib/orders/stage-colors'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// FOUR VIEWS ONTO ONE LIST, and "Open" is the default because that is the working set.
//
// ~30 estimates a day and a handful convert means the closed ones outnumber the live ones within a
// week and outnumber them ten to one within a month. A list that defaults to everything is a list
// where today's work is on page four. The closed ones are one tap away and are never hidden — that
// was the whole requirement — but they are not what the screen opens on.
//
// Every view is a STATUS GROUP (lib/orders/stages.ts orderStatusGroup), never a hand-written list of
// stages — so a closed order is a closed order here, on the customer's history and on the board,
// and a new stage cannot leak into "Open" by being forgotten in one of them.
const VIEWS: { key: string; label: string; test: (s: OrderStage) => boolean }[] = [
  { key: 'open', label: 'Open', test: (s) => orderStatusGroup(s) === 'active' },
  { key: 'no_sale', label: 'Closed – No Sale', test: (s) => orderStatusGroup(s) === 'no_sale' },
  { key: 'done', label: 'Closed Orders', test: (s) => orderStatusGroup(s) === 'closed' },
  { key: 'cancelled', label: 'Cancelled', test: (s) => orderStatusGroup(s) === 'cancelled' },
  { key: 'all', label: 'All', test: () => true },
]

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const all = await listOrders()
  const sp = await searchParams
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0]
  // A search runs across EVERY order regardless of view: "find Irina's bracelet" must find the one
  // that closed as a no-sale eight months ago, which is the whole point of keeping it.
  const q = (sp.q ?? '').trim().toLowerCase()
  const matches = (o: typeof all[number]) => !q || [o.orderNumber, o.customerName, o.customerCompany, o.customerEmail, o.customerPhone, o.factoryName]
    .some((v) => (v ?? '').toLowerCase().includes(q))
  const orders = all.filter((o) => (q ? true : view.test(o.stage as OrderStage)) && matches(o))
  const countOf = (v: typeof VIEWS[number]) => all.filter((o) => v.test(o.stage as OrderStage)).length

  return (
    <div className="v2 v2-embedded mx-auto max-w-6xl p-4 sm:p-6">
      {/* No 24px page title: the rail says Orders. The micro-label carries the count, and the three
          verbs are the kit's pills — one filled, because "New Order" is what you came for. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
          <i />{view.label} · {orders.length}
        </p>
        <s />
        <Link href="/settings/options" className="v2-act">Dropdowns</Link>
        <Link href="/orders/memos" className="v2-act">Memos</Link>
        <Link href="/orders/board" className="v2-act">Board</Link>
        <Link href="/orders/new" className="v2-act" data-solid>New order</Link>
      </div>

      {/* The four views, as the kit's chips — the same control /inbox and /catalog filter with. Each
          carries its own count, so "how many did we lose this month" is answered without a click. */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.key === 'open' ? '/orders' : `/orders?view=${v.key}`}
                className="v2-chip" data-on={!q && v.key === view.key || undefined}>
            {v.label} <span style={{ opacity: 0.6 }}>{countOf(v)}</span>
          </Link>
        ))}
        <form method="get" action="/orders" className="v2-fld" style={{ marginLeft: 'auto', minWidth: 200 }}>
          <label htmlFor="orders-q" className="sr-only">Search orders</label>
          <input id="orders-q" name="q" defaultValue={sp.q ?? ''} placeholder="Search customer, company, order №…" />
        </form>
      </div>
      {q && <p className="v2-kick" style={{ marginBottom: 10 }}>Matching “{sp.q}” across every order, open or closed · {orders.length}</p>}

      {orders.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>{all.length === 0 ? 'No orders yet' : `Nothing is ${view.label.toLowerCase()}`}</b>
          <span>{all.length === 0
            ? 'Create your first order and it will appear here, with its stage, its factory and everything sent for approval.'
            : 'Every order you have is still here — try another view.'}</span>
        </div>
      ) : (
        <>
          {/* THE KIT'S TABLE ON DESKTOP, THE KIT'S ROW ON A PHONE — the same pair /contacts uses and
              for the same reason: an order genuinely has columns (number, customer, stage, factory,
              total, requested) and they line up, but six of them at 390px is a sideways scrollbar.
              Both are driven by the same `orders` array and the same two helpers, so the phone shows
              a strict subset rather than a second opinion. v1 built its desktop table out of CSS
              grid with a hand-made header row; this is a real table, which is what the kit's
              micro-label headers and hover rule are written for. */}
          <div className="hidden md:block">
            <table className="v2-tbl">
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>Stage</th>
                  <th className="max-lg:hidden">Factory</th><th>Total</th><th className="max-lg:hidden">Requested</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={{ ['--chan' as string]: stageHue(o.stage) }}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="block truncate"
                            style={{ fontFamily: 'var(--v2-mono)', fontSize: 12.5, color: 'var(--v2-ink)' }}>
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td style={{ color: 'var(--v2-ink)' }}>{o.customerCompany || o.customerName || '—'}{o.customerCompany && o.customerName ? <span className="v2-hint"> · {o.customerName}</span> : null}</td>
                    <td><span className="v2-stat">{STAGE_LABELS[o.stage]}</span>{orderStatusGroup(o.stage) === 'closed' && <span className="v2-hint" style={{ marginLeft: 6 }}>Closed Order</span>}</td>
                    <td className="max-lg:hidden" style={{ color: 'var(--v2-ink-72)' }}>{o.factoryName ?? '—'}</td>
                    <td style={{ color: 'var(--v2-ink)', fontVariantNumeric: 'tabular-nums' }}>{money(o.subtotalCents, o.currency)}</td>
                    <td className="max-lg:hidden" style={{ color: 'var(--v2-ink-72)' }}>{o.requestedCompletionDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="v2-list md:hidden -mx-4">
            {orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="v2-row tap-target" data-click
                    style={{ ['--chan' as string]: stageHue(o.stage) }}>
                <div className="v2-m">
                  <p className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="truncate">{o.customerName ?? 'No customer'}</span>
                    <span className="v2-stat">{STAGE_LABELS[o.stage]}</span>
                  </p>
                  <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11.5 }}>
                    {o.orderNumber}{o.factoryName ? ` · ${o.factoryName}` : ''}
                  </span>
                </div>
                <div className="v2-meta">
                  <em style={{ fontVariantNumeric: 'tabular-nums' }}>{money(o.subtotalCents, o.currency)}</em>
                  {o.requestedCompletionDate && <em>{o.requestedCompletionDate}</em>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
