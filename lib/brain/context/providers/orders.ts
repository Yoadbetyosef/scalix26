import type { ContextProvider } from '../types'
import { STAGE_LABELS } from '@/lib/orders/stages'

const label = (stage: string) => (STAGE_LABELS as Record<string, string>)[stage] ?? stage

// Orders / Order status / Tracking. Isolation-critical: only ever return an order matched by an explicit
// order number in the message, OR orders belonging to the IDENTIFIED customer (contactId). Never dump all
// orders (that would leak one customer's orders to another).
export const ordersProvider: ContextProvider = {
  key: 'orders',
  label: 'Orders',
  keywords: ['order', 'orders', 'order status', 'status of', 'tracking', 'track', 'delivery', 'deliver', 'shipped', 'ship', 'ready', 'pick up', 'pickup', 'when will', 'my order'],
  async fetch(req, db) {
    const m = (req.query || '').toUpperCase().match(/ORD-[A-Z0-9]{4,}/)
    if (m) {
      const { data } = await db
        .from('orders')
        .select('order_number, stage, estimated_completion_date')
        .eq('tenant_id', req.tenantId)
        .eq('order_number', m[0])
        .maybeSingle()
      if (!data) return { available: false, text: `No order found with number ${m[0]}.` }
      const eta = data.estimated_completion_date ? `, estimated completion ${data.estimated_completion_date}` : ''
      return { available: true, text: `Order ${data.order_number}: status "${label(data.stage)}"${eta}. (There is no carrier tracking number in the system.)` }
    }
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
