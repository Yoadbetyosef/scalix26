import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { ORDER_STAGES, STAGE_LABELS, isProtectedStage, hasNoBoardColumn, type OrderStage } from '@/lib/orders/stages'
import { Lock } from 'lucide-react'
import { stageColor, stageHue, STAGE_COLUMN_WIDTH } from '@/lib/orders/stage-colors'

export const dynamic = 'force-dynamic'
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// Kanban view. Columns are the workflow stages; approval columns are marked (their cards move only via the
// order's workflow actions, not free drag). Cards link to the order for actions.
//
// Each column carries its own hue (lib/orders/stage-colors) — a rule across the top and a tinted header —
// so thirteen stages are told apart at a glance instead of reading as one wall. The column bodies stay
// neutral so the cards, not the chrome, are what you look at.
export default async function OrdersBoardPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const orders = await listOrders()
  const byStage = (s: OrderStage) => orders.filter((o) => o.stage === s)

  return (
    <div className="v2 v2-embedded p-4 sm:p-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Board · {orders.length}</p>
        <s />
        <Link href="/orders" className="v2-act">Table</Link>
        <Link href="/orders/new" className="v2-act" data-solid>New order</Link>
      </div>

      {/* THE COLUMN HUES ARE UNCHANGED — that fan is a designed thing, thirteen hues no two of which
          sit closer than 16°, and the table now reads from the same one via stageHue. What changed
          is the chrome around them: v1 wrapped each column in a grey card on a grey body, so the
          board read as a wall of boxes with the hue reduced to a 3px rule. The hue is the column
          now — a tinted header on paper, one hairline, and the cards inside are the kit's rows. */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {/* The exclusion is a rule now rather than two stage names written here: 'closed_no_sale'
            is the third place work leaves the board for, and a board that grew a column of thirty
            lost quotes a day would be a board nobody could work from. See hasNoBoardColumn. */}
        {ORDER_STAGES.filter((s) => !hasNoBoardColumn(s)).map((s) => {
          const c = stageColor(s)
          const rows = byStage(s)
          return (
            <div key={s} className={`${STAGE_COLUMN_WIDTH} shrink-0 overflow-hidden`}
                 style={{ border: '1px solid var(--v2-line)', borderRadius: 'var(--v2-radius-card)', background: 'var(--v2-paper)' }}>
              <div className="flex items-center justify-between gap-2 px-3 py-2.5"
                   style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}>
                <span className="v2-kick" style={{ color: c.text, whiteSpace: 'nowrap' }}>{STAGE_LABELS[s]}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="v2-kick" style={{ color: c.text, opacity: 0.8 }}>{rows.length}</span>
                  {/* An approval stage moves only through the order's own workflow actions. It was a
                      padlock emoji; a title on an emoji is not a label anyone reads. */}
                  {isProtectedStage(s) && (
                    <Lock aria-label="Approval stage — moves via workflow actions only"
                          style={{ width: 11, height: 11, color: c.text, opacity: 0.7 }} />
                  )}
                </span>
              </div>
              <div className="v2-list">
                {rows.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="v2-row" data-click
                        style={{ ['--chan' as string]: stageHue(s), padding: '11px 13px' }}>
                    <div className="v2-m">
                      <p className="truncate">{o.customerName ?? 'No customer'}</p>
                      <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11 }}>
                        {o.orderNumber} · {money(o.subtotalCents)}{o.factoryName ? ` · ${o.factoryName}` : ''}
                      </span>
                    </div>
                  </Link>
                ))}
                {rows.length === 0 && <p className="v2-kick" style={{ padding: '14px 13px' }}>Nothing here</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
