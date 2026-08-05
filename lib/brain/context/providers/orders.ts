import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContextProvider, ContextRequest, ContextResult } from '../types'
import { STAGE_LABELS, isTerminalStage, type OrderStage } from '@/lib/orders/stages'

const label = (stage: string) => (STAGE_LABELS as Record<string, string>)[stage] ?? stage
const today = () => new Date().toISOString().slice(0, 10)

// Stages where an order is parked waiting on somebody — the ones an owner actually chases.
const WAITING: OrderStage[] = ['waiting_factory_approval', 'waiting_customer_approval', 'factory_changes_requested', 'customer_changes_requested']

interface OrderRow {
  order_number: string; stage: string; customer_name: string | null
  requested_completion_date: string | null; estimated_completion_date: string | null
  is_custom_design: boolean | null; created_at: string
}

const line = (o: OrderRow) => {
  const who = o.customer_name ? ` — ${o.customer_name}` : ''
  const due = o.estimated_completion_date ? `, est. ${o.estimated_completion_date}`
    : o.requested_completion_date ? `, requested ${o.requested_completion_date}` : ''
  return `- ${o.order_number}${who}: ${label(o.stage)}${due}${o.is_custom_design ? ' [custom design]' : ''}`
}

// The owner asking about her own operation: how many, what's stuck, what's late, what's recent. This is
// the view the dashboard assistant needs, and the one the customer-facing branch must never produce.
async function ownerView(req: ContextRequest, db: SupabaseClient): Promise<ContextResult> {
  const { data } = await db
    .from('orders')
    .select('order_number, stage, customer_name, requested_completion_date, estimated_completion_date, is_custom_design, created_at')
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false })
    .limit(300)
  const orders = (data as OrderRow[] | null) ?? []
  if (!orders.length) return { available: true, text: 'There are no orders in the system yet.' }

  const open = orders.filter((o) => !isTerminalStage(o.stage as OrderStage))
  const byStage = new Map<string, number>()
  for (const o of orders) byStage.set(o.stage, (byStage.get(o.stage) ?? 0) + 1)

  const waiting = open.filter((o) => WAITING.includes(o.stage as OrderStage))
  const t = today()
  // Late = a date has already passed and the order still isn't finished.
  const late = open.filter((o) => {
    const due = o.estimated_completion_date || o.requested_completion_date
    return due && due < t
  })

  const parts: string[] = [
    `${orders.length} order${orders.length === 1 ? '' : 's'} in total, ${open.length} still open.`,
    `By stage: ${[...byStage.entries()].map(([s, n]) => `${label(s)} ${n}`).join(', ')}.`,
    waiting.length
      ? `\nWaiting on a response (${waiting.length}):\n${waiting.slice(0, 15).map(line).join('\n')}`
      : '\nNothing is currently waiting on a factory or customer response.',
  ]
  if (late.length) parts.push(`\nPast their date (${late.length}) — today is ${t}:\n${late.slice(0, 15).map(line).join('\n')}`)

  // EVERY order, each with its customer name. Questions are asked by person far more often than by
  // order number ("what's happening with Andrea's ring?"), and no amount of number-matching answers
  // those — the model needs the names in front of it to match on. Capped so the block stays sane.
  const listed = orders.slice(0, 60)
  parts.push(`\nAll orders${orders.length > listed.length ? ` (most recent ${listed.length} of ${orders.length})` : ''}, by customer:\n${listed.map(line).join('\n')}`)
  parts.push('\nMatch a customer by name against this list to answer questions about their order. Ask about a specific order number for its full specification.')
  return { available: true, text: parts.join('\n') }
}

// Full detail for one order. The customer answer is status-only; the owner gets the specification,
// the money and the brief — everything she'd otherwise open the order page to read.
async function orderDetail(req: ContextRequest, db: SupabaseClient, orderNumber: string, forOwner: boolean): Promise<ContextResult> {
  const { data } = await db
    .from('orders')
    .select('id, order_number, stage, customer_name, estimated_completion_date, subtotal_cents, deposit_cents, balance_cents, currency, is_custom_design, client_requirements')
    .eq('tenant_id', req.tenantId)
    .eq('order_number', orderNumber)
    .maybeSingle()
  if (!data) return { available: false, text: `No order found with number ${orderNumber}.` }

  const eta = data.estimated_completion_date ? `, estimated completion ${data.estimated_completion_date}` : ''
  if (!forOwner) {
    // Unchanged customer-facing answer: status only. No pricing, no specification, no other orders.
    return { available: true, text: `Order ${data.order_number}: status "${label(data.stage as string)}"${eta}. (There is no carrier tracking number in the system.)` }
  }

  const { data: items } = await db
    .from('order_line_items')
    .select('product_name, quantity, stone_type, stone_origin, stone_quality, stone_color, center_stone_shape, center_stone_carat, side_stone_shape, side_stone_carat_total, metal_karat, certificate_lab, ring_size, measurements')
    .eq('order_id', data.id as string).order('display_order')

  const cur = ((data.currency as string) ?? 'usd').toUpperCase()
  const money = (c: unknown) => `${((Number(c) || 0) / 100).toLocaleString()} ${cur}`
  const spec = (l: Record<string, unknown>) => [
    l.stone_type, l.stone_origin, l.stone_quality, l.stone_color,
    l.center_stone_shape, l.center_stone_carat ? `${l.center_stone_carat}ct centre` : null,
    l.side_stone_shape, l.side_stone_carat_total ? `${l.side_stone_carat_total}ct side` : null,
    l.certificate_lab ? `${l.certificate_lab} cert` : null,
    l.metal_karat, l.ring_size ? `size ${l.ring_size}` : null, l.measurements,
  ].filter(Boolean).join(' · ')
  const lines = ((items as Array<Record<string, unknown>> | null) ?? [])
    .map((l) => `  - ${l.product_name} ×${l.quantity}${spec(l) ? `: ${spec(l)}` : ''}`)

  return { available: true, text: [
    `Order ${data.order_number}${data.customer_name ? ` for ${data.customer_name}` : ''}: ${label(data.stage as string)}${eta}.`,
    data.is_custom_design ? 'This is a custom design order.' : null,
    lines.length ? `Items:\n${lines.join('\n')}` : null,
    `Subtotal ${money(data.subtotal_cents)}, deposit ${money(data.deposit_cents)}, balance ${money(data.balance_cents)}.`,
    data.client_requirements ? `Client requirements: ${data.client_requirements}` : null,
  ].filter(Boolean).join('\n') }
}

// Orders / Order status / Tracking.
//
// Two audiences, two behaviours. For a CUSTOMER this stays isolation-critical: only an order they named
// themselves, or orders belonging to the identified contact — never a listing, which would leak one
// customer's orders to another. For the OWNER on her own dashboard, that listing is the entire question,
// and refusing it was why "how many orders are waiting on the factory?" got a non-answer.
export const ordersProvider: ContextProvider = {
  key: 'orders',
  label: 'Orders',
  keywords: ['order', 'orders', 'order status', 'status of', 'tracking', 'track', 'delivery', 'deliver', 'shipped', 'ship', 'ready', 'pick up', 'pickup', 'when will', 'my order', 'waiting on', 'overdue', 'late', 'factory', 'approval', 'production', 'custom design'],
  async fetch(req, db) {
    const isOwner = req.audience === 'owner'
    const m = (req.query || '').toUpperCase().match(/ORD-[A-Z0-9]{4,}/)
    if (m) return orderDetail(req, db, m[0], isOwner)
    if (isOwner) return ownerView(req, db)

    if (req.contactId) {
      const { data } = await db
        .from('orders')
        .select('order_number, stage, estimated_completion_date')
        .eq('tenant_id', req.tenantId)
        .eq('contact_id', req.contactId)
        .order('created_at', { ascending: false })
        .limit(5)
      if (data && data.length) {
        return { available: true, text: data.map((o) => `- ${o.order_number}: ${label(o.stage)}${o.estimated_completion_date ? ` (est. ${o.estimated_completion_date})` : ''}`).join('\n') }
      }
      return { available: false, text: 'No orders are on file for this customer. Ask for their order number to look one up.' }
    }
    return { available: false, text: 'To check an order, ask the customer for their order number (e.g. ORD-XXXXXXXX). Do not guess an order status.' }
  },
}
