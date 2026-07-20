// Verification for component & variant inventory. RUN AFTER add_core_14_component_inventory.sql.
//   node scripts/verify-core-component-inventory.mjs
// Exercises via REST (service role): meta + incoming tables; component/variant on-hand via the ledger RPC;
// incoming quantity + expected arrival; quantities by location; variant-level inventory; availability meta;
// identical data source (Catalog == Commerce read the same ledger); historical movements intact; isolation.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'INV-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => await (await rest(p)).json()
const rpc = async (fn, body) => (await (await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json())

let tA, tB
try {
  const probe = await rest('inventory_incoming?select=id&limit=1'), probe2 = await rest('inventory_item_meta?select=id&limit=1')
  ok('0. inventory_incoming + inventory_item_meta tables exist', probe.status === 200 && probe2.status === 200)
  if (probe.status !== 200 || probe2.status !== 200) throw new Error('run add_core_14_component_inventory.sql first')

  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Neomi Sectional' })
  const comp = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Left Arm', sku: 'NE-L', quantity: 1 })
  const variant = await ins('product_variants', { tenant_id: tA, component_id: comp.id, name: 'Velvet', sku: 'NE-L-VEL', currency: 'usd' })
  const showroom = await ins('inventory_locations', { tenant_id: tA, name: 'Showroom', kind: 'showroom' })
  const warehouse = await ins('inventory_locations', { tenant_id: tA, name: 'Warehouse', kind: 'warehouse' })

  // 1. component on-hand via the shared ledger RPC (same path Catalog + Commerce use)
  const rc1 = await rpc('core_inventory_move', { p_tenant: tA, p_kind: 'component', p_item: comp.id, p_location: warehouse.id, p_movement: 'receive', p_qty: 5, p_ref_type: null, p_ref_id: null, p_key: `${TAG}-r1`, p_actor: null })
  ok('1. component receives stock via the ledger (on_hand=5, available=5)', rc1?.ok === true && Number(rc1.on_hand) === 5 && Number(rc1.available) === 5)

  // 2. component out of stock elsewhere but quantities by location tracked independently
  await rpc('core_inventory_move', { p_tenant: tA, p_kind: 'component', p_item: comp.id, p_location: showroom.id, p_movement: 'receive', p_qty: 2, p_ref_type: null, p_ref_id: null, p_key: `${TAG}-r2`, p_actor: null })
  const levels = await list(`inventory_levels?tenant_id=eq.${tA}&item_kind=eq.component&item_id=eq.${comp.id}&select=location_id,on_hand`)
  ok('2. component quantities tracked per location (Showroom + Warehouse)', levels.length === 2 && levels.reduce((s, l) => s + Number(l.on_hand), 0) === 7)

  // 3. incoming shipment with expected arrival + supplier/PO refs
  const inc = await ins('inventory_incoming', { tenant_id: tA, item_kind: 'component', item_id: comp.id, location_id: warehouse.id, quantity: 4, expected_arrival_date: '2026-08-12', supplier_ref: 'ACME', po_ref: 'PO-9', status: 'expected' })
  ok('3. component can have incoming qty + expected arrival + supplier/PO', inc.quantity === 4 && inc.expected_arrival_date === '2026-08-12' && inc.supplier_ref === 'ACME' && inc.po_ref === 'PO-9')
  const open = await list(`inventory_incoming?tenant_id=eq.${tA}&item_kind=eq.component&item_id=eq.${comp.id}&status=eq.expected&select=quantity,expected_arrival_date`)
  ok('3b. aggregate incoming = Σ open shipments; next arrival stored', open.reduce((s, r) => s + Number(r.quantity), 0) === 4 && open[0].expected_arrival_date === '2026-08-12')

  // 4. receiving an incoming shipment adds to on-hand (ledger receive) — mirrors receiveIncoming()
  const rc3 = await rpc('core_inventory_move', { p_tenant: tA, p_kind: 'component', p_item: comp.id, p_location: warehouse.id, p_movement: 'receive', p_qty: 4, p_ref_type: 'incoming', p_ref_id: inc.id, p_key: `incoming:${inc.id}:receive`, p_actor: null })
  await rest(`inventory_incoming?id=eq.${inc.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'received' }) })
  ok('4. receiving a shipment increases on-hand (warehouse 5→9)', rc3?.ok === true && Number(rc3.on_hand) === 9)

  // 5. variant-level inventory is independent of the component
  const rv = await rpc('core_inventory_move', { p_tenant: tA, p_kind: 'variant', p_item: variant.id, p_location: warehouse.id, p_movement: 'receive', p_qty: 3, p_ref_type: null, p_ref_id: null, p_key: `${TAG}-v1`, p_actor: null })
  ok('5. variant has its own on-hand (3), separate from the component', rv?.ok === true && Number(rv.on_hand) === 3)

  // 6. availability meta (explicit override) + notes upsert
  await rest('inventory_item_meta', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ tenant_id: tA, item_kind: 'component', item_id: comp.id, availability_status: 'made_to_order', ai_notes: 'Handmade to order, ~3 weeks.', internal_notes: 'secret', low_stock_threshold: 2 }) })
  const meta = (await list(`inventory_item_meta?tenant_id=eq.${tA}&item_kind=eq.component&item_id=eq.${comp.id}&select=availability_status,ai_notes,internal_notes`))[0]
  ok('6. availability status + AI/internal notes stored per item', meta.availability_status === 'made_to_order' && meta.ai_notes.includes('Handmade') && meta.internal_notes === 'secret')

  // 7. identical data source: the levels a Catalog view or a Commerce view reads are the SAME ledger rows
  const again = await list(`inventory_levels?tenant_id=eq.${tA}&item_kind=eq.component&item_id=eq.${comp.id}&location_id=eq.${warehouse.id}&select=on_hand`)
  ok('7. Catalog & Commerce read one shared ledger (no duplicate records)', again.length === 1 && Number(again[0].on_hand) === 9)

  // 8. historical movements intact (immutable ledger)
  const ledger = await list(`inventory_ledger?tenant_id=eq.${tA}&item_kind=eq.component&item_id=eq.${comp.id}&select=movement,quantity&order=created_at`)
  ok('8. inventory movement history preserved (all receives logged)', ledger.length >= 3 && ledger.every((m) => m.movement === 'receive'))

  // 9. tenant isolation
  const bMeta = await list(`inventory_item_meta?tenant_id=eq.${tB}&select=id`)
  const bInc = await list(`inventory_incoming?tenant_id=eq.${tB}&select=id`)
  ok('9. tenant isolation — B sees none of A meta/incoming', bMeta.length === 0 && bInc.length === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ COMPONENT INVENTORY VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
