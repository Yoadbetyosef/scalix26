// Real-DB verification for Commerce Phase 4 (Purchasing / Receiving). RUN AFTER applying
// add_commerce_7_purchasing.sql. Proves the receiving RPCs against the real DB: mark_po_incoming raises
// incoming; receive_po_items raises on_hand, lowers incoming, updates PO received + status, bumps the
// linked customer order item's received bucket WITHOUT un-allocating, is idempotent, and rejects
// over-receipt. Cleans up.  node scripts/verify-commerce-purchasing.mjs
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
const level = async (item, loc) => (await (await rest(`commerce_inventory_levels?item_id=eq.${item}&location_id=eq.${loc}&select=on_hand,incoming`)).json())[0]

let tenantId, pId, locId, orderId, orderItemId, poId, poItemId
try {
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: `${TAG} tenant` }) })).json(); tenantId = t.id
  const [p] = await (await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} sofa`, product_type: 'simple_product' }) })).json(); pId = p.id
  const [loc] = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} WH`, type: 'warehouse' }) })).json(); locId = loc.id
  await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: pId, location_id: locId, on_hand: 0, reserved: 0, incoming: 0 }) })
  // a customer order + item ordered=2, allocated=0 (all missing)
  const [ord] = await (await rest('commerce_customer_orders', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, order_number: `${TAG}-SO`, status: 'purchasing_required' }) })).json(); orderId = ord.id
  const [oi] = await (await rest('commerce_order_items', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, order_id: orderId, product_id: pId, quantity_ordered: 2, quantity_allocated: 0, description_snapshot: `${TAG} sofa` }) })).json(); orderItemId = oi.id
  // a PO for the 2 missing units, linked to that order item
  const [po] = await (await rest('commerce_purchase_orders', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, po_number: `${TAG}-PO`, status: 'sent_to_supplier', customer_order_id: orderId }) })).json(); poId = po.id
  const [poi] = await (await rest('commerce_po_items', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, po_id: poId, product_id: pId, quantity: 2, unit_cost_cents: 300000, customer_order_id: orderId, customer_order_item_id: orderItemId }) })).json(); poItemId = poi.id
  ok('setup: order (ordered 2, allocated 0) + PO (2 units) linked', !!poItemId)

  // mark_po_incoming → incoming becomes 2
  await rpc('mark_po_incoming', { p_tenant: tenantId, p_po_id: poId, p_location_id: locId, p_by: 'verify' })
  let lv = await level(pId, locId)
  ok('mark_po_incoming raised incoming to 2 (on_hand still 0)', lv.incoming === 2 && lv.on_hand === 0)

  // receive 1 unit (partial)
  const key = `${TAG}-recv1`
  const r1 = await rpc('receive_po_items', { p_tenant: tenantId, p_po_id: poId, p_location_id: locId, p_lines: [{ po_item_id: poItemId, accepted: 1, damaged: 0 }], p_received_by: 'verify', p_idempotency_key: key })
  ok('receive 1 unit succeeded', r1.ok === true && !!r1.receipt_id)
  lv = await level(pId, locId)
  ok('on_hand rose to 1, incoming fell to 1', lv.on_hand === 1 && lv.incoming === 1)
  const poiAfter = (await (await rest(`commerce_po_items?id=eq.${poItemId}&select=received_quantity`)).json())[0]
  ok('PO item received_quantity = 1', Number(poiAfter.received_quantity) === 1)
  const oiAfter = (await (await rest(`commerce_order_items?id=eq.${orderItemId}&select=quantity_received,quantity_allocated`)).json())[0]
  ok('customer order item received=1 and STILL allocated=0 (customer-linked receipt stays with the order)', Number(oiAfter.quantity_received) === 1 && Number(oiAfter.quantity_allocated) === 0)
  const poStatus = (await (await rest(`commerce_purchase_orders?id=eq.${poId}&select=status`)).json())[0]
  ok('PO status is partially_received', poStatus.status === 'partially_received')

  // idempotency: repeat the same receipt key → no double-apply
  const r1again = await rpc('receive_po_items', { p_tenant: tenantId, p_po_id: poId, p_location_id: locId, p_lines: [{ po_item_id: poItemId, accepted: 1 }], p_received_by: 'verify', p_idempotency_key: key })
  lv = await level(pId, locId)
  ok('repeated receipt (same key) is idempotent — on_hand still 1', r1again.idempotent === true && lv.on_hand === 1)

  // over-receipt rejected (only 1 left; try 5)
  const over = await rpc('receive_po_items', { p_tenant: tenantId, p_po_id: poId, p_location_id: locId, p_lines: [{ po_item_id: poItemId, accepted: 5 }], p_received_by: 'verify', p_idempotency_key: `${TAG}-over` })
  ok('over-receipt (accept 5 when 1 outstanding) is rejected', over.ok === false && over.error === 'over_receipt')

  // receive the last unit → fully received
  await rpc('receive_po_items', { p_tenant: tenantId, p_po_id: poId, p_location_id: locId, p_lines: [{ po_item_id: poItemId, accepted: 1 }], p_received_by: 'verify', p_idempotency_key: `${TAG}-recv2` })
  lv = await level(pId, locId)
  const finalStatus = (await (await rest(`commerce_purchase_orders?id=eq.${poId}&select=status`)).json())[0]
  ok('after full receipt: on_hand 2, incoming 0, PO status received', lv.on_hand === 2 && lv.incoming === 0 && finalStatus.status === 'received')
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) await del(`tenants?id=eq.${tenantId}`)
  console.log('  (cleaned up throwaway tenant + all VERIFY-COMMERCE- rows via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PURCHASING/RECEIVING VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
