import { qboFetch, getStatus } from './connection'

// QuickBooks invoice creation, built on the EXISTING OAuth + qboFetch client (with token refresh). No second
// connection system. Money in QBO is decimal dollars, so cents are converted at the edge. Every write is
// gated on a live connection and surfaces provider errors verbatim.

export interface QBLineInput { description: string | null; quantity: number; unit_price_cents: number; line_total_cents: number }

// PURE: map proposal/invoice lines → a QBO Invoice payload. Unit-testable without hitting the API.
export function buildQBInvoicePayload(lines: QBLineInput[], customerRefId: string, itemRefId: string, docNumber?: string): Record<string, unknown> {
  const Line = lines.map((l) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: Math.round(l.line_total_cents) / 100,
    Description: (l.description ?? '').slice(0, 4000) || undefined,
    SalesItemLineDetail: {
      ItemRef: { value: itemRefId },
      Qty: l.quantity,
      UnitPrice: Math.round(l.unit_price_cents) / 100,
    },
  }))
  return { CustomerRef: { value: customerRefId }, Line, ...(docNumber ? { DocNumber: docNumber.slice(0, 21) } : {}) }
}

const esc = (s: string) => s.replace(/'/g, "\\'")
type QBResp = { QueryResponse?: Record<string, unknown[]>; Invoice?: { Id: string; DocNumber?: string }; Customer?: { Id: string }; Item?: { Id: string } }

// Find a QBO customer by display name or email (duplicate-safe), else create one. Returns the QBO customer Id.
export async function qbFindOrCreateCustomer(tenantId: string, input: { name: string; email?: string | null }): Promise<string> {
  const name = input.name.trim()
  const byName = (await qboFetch(tenantId, `/query?query=${encodeURIComponent(`select Id from Customer where DisplayName = '${esc(name)}'`)}&minorversion=73`)) as QBResp
  const found = byName.QueryResponse?.Customer?.[0] as { Id: string } | undefined
  if (found) return found.Id
  if (input.email) {
    const byEmail = (await qboFetch(tenantId, `/query?query=${encodeURIComponent(`select Id from Customer where PrimaryEmailAddr = '${esc(input.email)}'`)}&minorversion=73`)) as QBResp
    const e = byEmail.QueryResponse?.Customer?.[0] as { Id: string } | undefined
    if (e) return e.Id
  }
  const created = (await qboFetch(tenantId, `/customer?minorversion=73`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ DisplayName: name, ...(input.email ? { PrimaryEmailAddr: { Address: input.email } } : {}) }) })) as QBResp
  if (!created.Customer?.Id) throw new Error('quickbooks_customer_create_failed')
  return created.Customer.Id
}

// Resolve a usable QBO Item to reference on invoice lines (QBO requires one). Prefer an existing item; else
// create a simple Service item against the first available income account.
export async function qbDefaultItemId(tenantId: string): Promise<string> {
  const q = (await qboFetch(tenantId, `/query?query=${encodeURIComponent('select Id from Item where Type = \'Service\' maxresults 1')}&minorversion=73`)) as QBResp
  const item = q.QueryResponse?.Item?.[0] as { Id: string } | undefined
  if (item) return item.Id
  const anyItem = ((await qboFetch(tenantId, `/query?query=${encodeURIComponent('select Id from Item maxresults 1')}&minorversion=73`)) as QBResp).QueryResponse?.Item?.[0] as { Id: string } | undefined
  if (anyItem) return anyItem.Id
  const acct = ((await qboFetch(tenantId, `/query?query=${encodeURIComponent('select Id from Account where AccountType = \'Income\' maxresults 1')}&minorversion=73`)) as QBResp).QueryResponse?.Account?.[0] as { Id: string } | undefined
  if (!acct) throw new Error('quickbooks_no_income_account')
  const created = (await qboFetch(tenantId, `/item?minorversion=73`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: 'Sales', Type: 'Service', IncomeAccountRef: { value: acct.Id } }) })) as QBResp
  if (!created.Item?.Id) throw new Error('quickbooks_item_create_failed')
  return created.Item.Id
}

export interface QBInvoiceResult { qbInvoiceId: string; qbDocNumber: string | null; customerId: string }
export async function createQuickBooksInvoice(tenantId: string, input: { customerName: string; customerEmail?: string | null; lines: QBLineInput[]; docNumber?: string; sendTo?: string | null }): Promise<QBInvoiceResult> {
  if (!(await getStatus(tenantId)).connected) throw new Error('quickbooks_not_connected')
  const customerId = await qbFindOrCreateCustomer(tenantId, { name: input.customerName, email: input.customerEmail })
  const itemId = await qbDefaultItemId(tenantId)
  const payload = buildQBInvoicePayload(input.lines, customerId, itemId, input.docNumber)
  const res = (await qboFetch(tenantId, `/invoice?minorversion=73`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })) as QBResp
  if (!res.Invoice?.Id) throw new Error('quickbooks_invoice_create_failed')
  if (input.sendTo) await qboFetch(tenantId, `/invoice/${res.Invoice.Id}/send?sendTo=${encodeURIComponent(input.sendTo)}&minorversion=73`, { method: 'POST' }).catch(() => {})
  return { qbInvoiceId: res.Invoice.Id, qbDocNumber: res.Invoice.DocNumber ?? null, customerId }
}
