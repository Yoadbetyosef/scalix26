import type { ContextProvider } from '../types'

// Payments (and the closest thing to Invoices — there is no tenant invoice table). Customer-scoped:
// only the identified customer's payments. Never expose other customers' payment data.
export const paymentsProvider: ContextProvider = {
  key: 'payments',
  label: 'Payments & Balance',
  keywords: ['payment', 'pay', 'paid', 'balance', 'owe', 'owing', 'deposit', 'invoice', 'bill', 'receipt', 'refund', 'checkout'],
  async fetch(req, db) {
    if (!req.contactId) {
      return { available: false, text: 'No payment record is identified for this customer. The system does not issue formal invoices; do not state an amount owed unless it is confirmed here.' }
    }
    const { data } = await db
      .from('payments')
      .select('product_name, amount, currency, status, paid_at')
      .eq('tenant_id', req.tenantId)
      .eq('contact_id', req.contactId)
      .order('created_at', { ascending: false })
      .limit(5)
    if (!data || data.length === 0) return { available: false, text: 'No payments are on file for this customer.' }
    const money = (a: number, c: string | null) => `${(c || 'usd').toUpperCase() === 'USD' ? '$' : ''}${(a / 100).toFixed(2)}`
    return { available: true, text: data.map((p) => `- ${p.product_name || 'Payment'}: ${money(p.amount, p.currency)} — ${p.status}${p.paid_at ? ` (paid ${String(p.paid_at).slice(0, 10)})` : ''}`).join('\n') }
  },
}
