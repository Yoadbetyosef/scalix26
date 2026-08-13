import { listOrders } from '@/lib/orders/store'
import { STAGE_LABELS, isTerminalStage } from '@/lib/orders/stages'
import { OrderBody } from './[id]/body'
import { ListPage, type ListFilter, type ListRow } from '../list'
import { listPageContext, relativeTime, PREVIEW } from '../list-page'
import { ordersLine } from './line'

// Orders, reskinned. listOrders() is the store function /orders already calls — same rows, same
// tenant scope, same order — so this page adds no query.

export const dynamic = 'force-dynamic'

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100)

// Buckets follow the stage machine's own shape rather than inventing a taxonomy: waiting on someone,
// being made, finished.
const WAITING = ['new', 'waiting_factory_approval', 'factory_changes_requested', 'factory_approved', 'waiting_customer_approval', 'customer_changes_requested', 'customer_approved']
const MAKING = ['production', 'ready']
const DONE = ['delivered', 'completed', 'cancelled']

const FILTERS: ListFilter[] = [
  { id: 'open', label: 'Open', buckets: ['waiting', 'making'] },
  { id: 'waiting', label: 'Waiting', buckets: ['waiting'] },
  { id: 'making', label: 'In production', buckets: ['making'] },
  { id: 'done', label: 'Finished', buckets: ['done'] },
]

export default async function V2Orders({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams
  await listPageContext('orders')
  const orders = await listOrders()

  const rows: ListRow[] = orders.map((o) => {
    const bucket = WAITING.includes(o.stage) ? 'waiting' : MAKING.includes(o.stage) ? 'making' : 'done'
    return {
      id: o.id,
      primary: o.customerName || o.orderNumber,
      detail: [o.orderNumber, STAGE_LABELS[o.stage] ?? o.stage, o.subtotalCents ? money(o.subtotalCents, o.currency) : null]
        .filter(Boolean).join(' · '),
      trailing: relativeTime(o.createdAt),
      marked: bucket === 'waiting',
      muted: isTerminalStage(o.stage),
      href: `/v2/orders/${o.id}`,
      bucket,
      // Waiting on a decision is the state that needs someone; in production does not.
      needsYou: bucket === 'waiting',
      actions: [{ label: 'Open', tone: 'primary', disabledReason: PREVIEW }],
    }
  })

  return (
    <ListPage
      selectedId={open ?? null}
      // Rendered only above 1100px; ListPage decides, so a narrow viewport never builds a record.
      detail={open ? <OrderBody id={open} /> : null}
      title="Orders"
      line={ordersLine({
        waiting: rows.filter((r) => r.bucket === 'waiting').length,
        making: rows.filter((r) => r.bucket === 'making').length,
        oldestWaiting: rows.filter((r) => r.bucket === 'waiting').at(-1) ?? null,
      })}
      filters={FILTERS}
      initialFilter="open"
      rows={rows}
      backHref="/v2"
      empty={{ title: 'No orders yet', body: 'Custom pieces you take on appear here, from first quote to finished job.' }}
    />
  )
}
