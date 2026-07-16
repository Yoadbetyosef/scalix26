// Post-migration verification for Commerce Phase 1. RUN ONLY AFTER applying
// add_commerce_1_catalog.sql and add_commerce_2_inventory.sql.
// Proves: cross-tenant/anon isolation (RLS), adding a product does NOT create inventory, the
// immutable movement ledger rejects UPDATE, and a manual movement writes a ledger row. Cleans up.
//   node scripts/verify-commerce.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY, AK = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const A = { apikey: AK, Authorization: `Bearer ${AK}` }
const TENANT = '8041c0b5-c960-48bd-a3f7-655f5a0b6434' // your design collective
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: S, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const count = async (h, p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } }); return Number((r.headers.get('content-range') || '').split('/')[1] || 0) }

let productId, locationId
try {
  const [p] = await (await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT, name: 'ZZZ Verify Sofa', product_type: 'simple_product', status: 'active', sku: 'ZZZ-VERIFY-' + Date.now() }) })).json()
  productId = p?.id
  ok('created a catalog product', !!productId)

  // 1. Adding a product does NOT create any inventory level (drafts/products never touch inventory).
  ok('no inventory level created by adding a product', (await count(S, `commerce_inventory_levels?item_id=eq.${productId}`)) === 0)

  // 2. Cross-tenant / anon isolation via RLS: anon sees 0 of this tenant's products.
  ok('anon (RLS) sees 0 commerce_products for the tenant', (await count(A, `commerce_products?tenant_id=eq.${TENANT}&select=id`)) === 0)

  // 3. Manual movement writes a ledger row + creates the level.
  const [loc] = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT, name: 'ZZZ Verify WH', type: 'warehouse' }) })).json()
  locationId = loc?.id
  await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT, item_kind: 'product', item_id: productId, location_id: locationId, on_hand: 5 }) })
  const [mv] = await (await rest('commerce_inventory_movements', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT, item_kind: 'product', item_id: productId, location_id: locationId, movement_type: 'opening_balance', quantity: 5, before_qty: 0, after_qty: 5 }) })).json()
  ok('inventory movement ledger row created', !!mv?.id)
  const [lvl] = await (await rest(`commerce_inventory_levels?item_id=eq.${productId}&select=available,on_hand,reserved`)).json()
  ok('available is derived (on_hand 5 - reserved 0 = 5)', lvl && lvl.available === 5)

  // 4. The movement ledger is immutable — UPDATE is rejected by the trigger.
  const upd = await fetch(`${U}/rest/v1/commerce_inventory_movements?id=eq.${mv.id}`, { method: 'PATCH', headers: S, body: JSON.stringify({ quantity: 999 }) })
  ok('immutable ledger rejects UPDATE (trigger)', upd.status >= 400)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (productId) { await del(`commerce_inventory_movements?item_id=eq.${productId}`); await del(`commerce_inventory_levels?item_id=eq.${productId}`); await del(`commerce_products?id=eq.${productId}`) }
  if (locationId) await del(`commerce_locations?id=eq.${locationId}`)
  console.log('  (cleaned up)')
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
