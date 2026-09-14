import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { ORDER_STAGES, hasNoBoardColumn, type OrderStage } from '@/lib/orders/stages'
import { BoardColumns, type BoardCard } from '@/components/orders/board-columns'
import { getSchemaCapabilities, stageSupported } from '@/lib/db/capabilities'

export const dynamic = 'force-dynamic'

// Kanban view. Columns are the workflow stages; approval columns are marked (their cards move only via the
// order's workflow actions, not free drag). Cards link to the order for actions.
//
// Each column carries its own hue (lib/orders/stage-colors) — a rule across the top and a tinted header —
// so the stages are told apart at a glance instead of reading as one wall. The column bodies stay
// neutral so the cards, not the chrome, are what you look at.
//
// ── THE COLUMNS MOVED INTO A CLIENT COMPONENT ───────────────────────────────────────────────────
//
// Dragging needs event handlers, so the columns are now components/orders/board-columns.tsx. This
// page keeps what a server component is for: the guard, the read, and deciding WHICH columns exist.
// It hands down plain data — no functions, no order objects with methods — so the boundary stays a
// serialisable one.
//
// Two columns are new. 'Pending' is a new stage for a job that is parked rather than lost or
// untouched; 'Lost business' is `closed_no_sale`, which had deliberately been kept OFF the board on
// the reasoning that thirty lost quotes a day would grow a column nobody could work from. That was
// true of a column you read and false of one you can drag into — see lib/orders/stages.ts.
export default async function OrdersBoardPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const orders = await listOrders()

  // A column for every stage the DATABASE accepts today. A stage a pending migration part adds is
  // left off rather than shown as a column a drop would be refused into.
  const caps = await getSchemaCapabilities()
  const stages: OrderStage[] = ORDER_STAGES.filter((s) => !hasNoBoardColumn(s) && stageSupported(caps, s))
  // Exactly the fields a card draws, and nothing else. An order carries internal costs and internal
  // notes; a client component receives a projection so those never cross the boundary at all.
  const cards: BoardCard[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerCompany: o.customerCompany ?? null,
    factoryName: o.factoryName,
    subtotalCents: o.subtotalCents,
    stage: o.stage,
  }))

  return (
    <div className="v2 v2-embedded p-4 sm:p-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Board · {orders.length}</p>
        <s />
        <Link href="/orders" className="v2-act">Table</Link>
        <Link href="/orders/new" className="v2-act" data-solid>New order</Link>
      </div>

      {/* Said once, at the top, rather than as a tooltip on every card: dragging is a desktop
          gesture and the HTML5 API this uses does not fire on touch, so every card also has a ⋯
          menu that moves it — the same transition, through the same route. */}
      <p className="v2-kick" style={{ marginBottom: 10 }}>
        Drag a card to any stage, forwards or back — or use the ⋯ on a card. Every move is on the order&apos;s timeline.
      </p>

      <BoardColumns stages={stages} cards={cards} />
    </div>
  )
}
