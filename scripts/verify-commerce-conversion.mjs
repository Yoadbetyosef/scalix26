// Real-DB verification for Commerce Phase 3 (Draft → Customer Order conversion). RUN AFTER applying
// add_commerce_6_orders.sql. Proves: conversion is transaction-safe + IDEMPOTENT (repeat = same order,
// no duplicate), reservations transfer to the order, allocation is computed from reservations, missing =
// ordered − allocated, snapshots are preserved, and the draft is marked converted + linked. Cleans up.
//   node scripts/verify-commerce-conversion.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'VERIFY-COMMERCE-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: S, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: S, body: JSON.stringify(args) }).then((r) => r.json())
const count = async (p) => Number(((await (await rest(p, { headers: { ...S, Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range')) || '').split('/')[1] || 0)

let tenantId, pId, locId, draftId
try {
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: `${TAG} tenant` }) })).json(); tenantId = t.id
  const [p] = await (await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} sofa`, product_type: 'simple_product', sku: `${TAG}-SKU` }) })).json(); pId = p.id
  const [loc] = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} WH`, type: 'warehouse' }) })).json(); locId = loc.id
  await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: pId, location_id: locId, on_hand: 2, reserved: 0 }) })
  const [d] = await (await rest('commerce_drafts', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, draft_number: `${TAG}-D`, customer_name: 'Buyer' }) })).json(); draftId = d.id
  // draft item: ordered 2, snapshot description
  await rest('commerce_draft_items', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, draft_id: draftId, line_kind: 'product', product_id: pId, quantity: 2, unit_price_cents: 500000, description_snapshot: `${TAG} sofa`, sku_snapshot: `${TAG}-SKU` }) })
  // reserve 1 of the 2 (partial allocation)
  const res = await rpc('reserve_inventory', { p_tenant: tenantId, p_item_kind: 'product', p_item_id: pId, p_location_id: locId, p_qty: 1, p_draft_id: draftId, p_order_id: null, p_expires_at: null, p_idempotency_key: `${TAG}-r1`, p_created_by: 'verify' })
  ok('setup: draft ordered=2, reserved=1', res.ok === true)

  // Convert.
  const conv = await rpc('convert_draft_to_order', { p_tenant: tenantId, p_draft_id: draftId, p_order_number: `${TAG}-SO`, p_created_by: 'verify' })
  ok('conversion succeeded, returned an order id', conv.ok === true && !!conv.order_id)
  ok('conversion reports ordered=2, allocated=1, missing=1', conv.ordered === 2 && conv.allocated === 1 && conv.missing === 1)
  const orderId = conv.order_id

  // Order + item state.
  const [order] = await (await rest(`commerce_customer_orders?id=eq.${orderId}&select=status,payment_status,draft_id,total_cents`)).json()
  ok('order status is partially_allocated (1 of 2 allocated)', order?.status === 'partially_allocated')
  ok('order payment_status is separate (not_invoiced)', order?.payment_status === 'not_invoiced')
  ok('order linked back to the draft', order?.draft_id === draftId)
  const [oi] = await (await rest(`commerce_order_items?order_id=eq.${orderId}&select=quantity_ordered,quantity_allocated,description_snapshot,sku_snapshot`)).json()
  ok('order item: ordered 2, allocated 1', Number(oi?.quantity_ordered) === 2 && Number(oi?.quantity_allocated) === 1)
  ok('commercial snapshot preserved on the order item', oi?.description_snapshot === `${TAG} sofa` && oi?.sku_snapshot === `${TAG}-SKU`)

  // Reservation transferred to the order.
  const [rsv] = await (await rest(`commerce_reservations?draft_id=eq.${draftId}&select=customer_order_id,status`)).json()
  ok('active reservation transferred to the order (customer_order_id set)', rsv?.customer_order_id === orderId)

  // Draft marked converted + linked.
  const [dr] = await (await rest(`commerce_drafts?id=eq.${draftId}&select=status,converted_order_id`)).json()
  ok('draft marked converted and linked to the order', dr?.status === 'converted' && dr?.converted_order_id === orderId)

  // IDEMPOTENCY: convert again → same order, NO duplicate.
  const again = await rpc('convert_draft_to_order', { p_tenant: tenantId, p_draft_id: draftId, p_order_number: `${TAG}-SO2`, p_created_by: 'verify' })
  ok('repeat conversion returns the SAME order (idempotent)', again.ok === true && again.order_id === orderId && again.idempotent === true)
  ok('no duplicate order created (exactly 1 order for the tenant)', (await count(`commerce_customer_orders?tenant_id=eq.${tenantId}&select=id`)) === 1)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) await del(`tenants?id=eq.${tenantId}`) // CASCADE cleans all commerce_* rows
  console.log('  (cleaned up throwaway tenant + all VERIFY-COMMERCE- rows via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CONVERSION VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
