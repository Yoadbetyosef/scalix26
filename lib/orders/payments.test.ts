import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { orderTotals, sumPayments, ORDER_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, isOrderPaymentMethod } from './payment-types'

// Deposit → partial → final, and the five numbers the invoice prints, from the one function every
// surface reads. Pure; the ledger round trip against the database is scripts/verify-tg-production.mjs.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const order = { subtotalCents: 500000, depositCents: 0, deliveryProvince: 'BC', taxLabel: 'GST + PST', taxRatePercent: 12 }

describe('orderTotals — subtotal, tax, total, paid, balance due', () => {
  it('a taxable order with nothing paid', () => {
    const t = orderTotals(order)
    expect(t).toMatchObject({ subtotalCents: 500000, taxCents: 60000, totalCents: 560000, paidCents: 0, dueCents: 560000, status: 'unpaid' })
  })
  it('a deposit leaves a balance', () => {
    const t = orderTotals(order, { paidCents: 100000 })
    expect(t.dueCents).toBe(460000)
    expect(t.status).toBe('partial')
  })
  it('a second payment that clears the balance is paid in full', () => {
    const paid = sumPayments([{ amountCents: 100000 }, { amountCents: 460000 }])
    const t = orderTotals(order, { paidCents: paid })
    expect(t.dueCents).toBe(0)
    expect(t.status).toBe('paid')
  })
  it('a refund is negative in the ledger and comes off paid', () => {
    const paid = sumPayments([{ amountCents: 560000 }, { amountCents: -60000 }])
    expect(orderTotals(order, { paidCents: paid })).toMatchObject({ paidCents: 500000, dueCents: 60000, status: 'partial' })
  })
  it('overpayment is named, not hidden', () => {
    expect(orderTotals(order, { paidCents: 600000 }).status).toBe('overpaid')
    expect(orderTotals(order, { paidCents: 600000 }).dueCents).toBe(-40000)
  })
  it('with no tax snapshot there is no tax, and the typed deposit is the default paid figure', () => {
    const t = orderTotals({ subtotalCents: 1000, depositCents: 250, deliveryProvince: null, taxLabel: null, taxRatePercent: null })
    expect(t).toMatchObject({ taxCents: 0, totalCents: 1000, paidCents: 250, dueCents: 750, status: 'partial' })
  })
  it('a tax resolved by the document wins over the snapshot', () => {
    // Orders raised before the picker have no snapshot; the document resolves a live rate and
    // passes it in, and the page must print the same figure.
    const t = orderTotals({ subtotalCents: 1000, depositCents: 0, deliveryProvince: 'ON', taxLabel: null, taxRatePercent: null }, { taxCents: 130 })
    expect(t.totalCents).toBe(1130)
  })
})

describe('payment methods', () => {
  it('offers the six the business takes, with no card details anywhere', () => {
    expect([...ORDER_PAYMENT_METHODS]).toEqual(['card', 'cheque', 'cash', 'wire', 'etransfer', 'other'])
    for (const m of ORDER_PAYMENT_METHODS) expect(PAYMENT_METHOD_LABELS[m]).toBeTruthy()
    expect(isOrderPaymentMethod('zelle')).toBe(false)
    // The API schema has no field for a card number, expiry or CVV, and the panel says so.
    const route = src('app/api/orders/[id]/payments/route.ts')
    expect(route).not.toMatch(/cardNumber|pan\b|cvv|expiry/i)
    expect(src('components/orders/payments-panel.tsx')).toMatch(/Card numbers are never stored/)
  })
})

describe('the ledger, not a new table', () => {
  it('order payments are rows in payment_allocations with document_type order', () => {
    const s = src('lib/orders/payments.ts')
    expect(s).toMatch(/from\('payment_allocations'\)/)
    expect(s).toMatch(/document_type: 'order'/)
    expect(s).not.toMatch(/from\('order_payments'\)/)
  })
  it('writes the running total back to deposit_cents so every older reader sees it', () => {
    expect(src('lib/orders/payments.ts')).toMatch(/update\(\{ deposit_cents: paid, balance_cents: Number\(o\.subtotal_cents \?\? 0\) - paid/)
  })
  it('carries a pre-ledger deposit into the ledger before the first recorded payment', () => {
    const s = src('lib/orders/payments.ts')
    expect(s).toMatch(/await carryLegacyDeposit\(db, c\.tenantId, orderId, o\)/)
    expect(s).toMatch(/idempotency_key: key/)
  })
  it('the document, the page and the panel all read orderTotals', () => {
    expect(src('components/orders/document-body.tsx')).toMatch(/orderTotals\(o, \{ taxCents: tax\?\.amountCents \?\? 0 \}\)/)
    expect(src('app/orders/[id]/page.tsx')).toMatch(/orderTotals\(o, \{ taxCents: tax\?\.amountCents \?\? 0, paidCents:/)
    expect(src('app/orders/[id]/page.tsx')).not.toMatch(/money\(o\.balanceCents/)
  })
})

describe('the invoice does not wait for production', () => {
  it('raiseInvoice refuses only a cancelled order', () => {
    const s = src('lib/orders/finish.ts')
    const fn = s.slice(s.indexOf('export async function raiseInvoice'), s.indexOf('export async function archiveToInventory'))
    expect(fn).toMatch(/order\.stage === 'cancelled'/)
    expect(fn).not.toMatch(/'completed'|'finished'/)
  })
  it('the order page offers the invoice wherever document facts are editable', () => {
    expect(src('app/orders/[id]/page.tsx')).toMatch(/canEditDocumentFacts\(o\.stage\) && <InvoiceButton/)
  })
})
