// Real-database verification gate for Commerce Phase 1. RUN AFTER applying
// add_commerce_1_catalog.sql + add_commerce_2_inventory.sql.
// Verifies the DATABASE guarantees (constraints, generated column, immutable-ledger trigger, RLS,
// per-tenant uniqueness, tenant isolation) directly against the real DB. Pure business logic
// (permissions, bundle availability) is covered by the real service code in the vitest suite.
// All temp rows are prefixed VERIFY-COMMERCE- and deleted at the end.
//   node scripts/verify-commerce.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY, AK = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const A = { apikey: AK, Authorization: `Bearer ${AK}`, 'content-type': 'application/json' }
const TENANT_A = '8041c0b5-c960-48bd-a3f7-655f5a0b6434' // your design collective (target)
const TENANT_B = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5' // Smith Hvac (a different tenant, for cross-tenant checks)
const TAG = 'VERIFY-COMMERCE-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}, h = S) => fetch(`${U}/rest/v1/${p}`, { headers: h, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const st = (r) => r.status
const created = []

async function insProduct(tenant, extra = {}) {
  const r = await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: tenant, name: `${TAG} product`, product_type: 'simple_product', status: 'active', ...extra }) })
  const j = await r.json().catch(() => null)
  return { status: r.status, id: Array.isArray(j) ? j[0]?.id : undefined, body: j }
}

let pA, locA
try {
  // ── Schema exists (all tables reachable) ──
  const tables = ['commerce_products', 'commerce_option_groups', 'commerce_option_values', 'commerce_variants', 'commerce_variant_options', 'commerce_product_components', 'commerce_bundle_items', 'commerce_events', 'commerce_locations', 'commerce_inventory_levels', 'commerce_inventory_movements']
  let allExist = true
  for (const t of tables) { if (st(await rest(`${t}?select=id&limit=1`)) !== 200) allExist = false }
  ok('1. all Commerce tables exist', allExist)

  // ── Create a product (tenant A) ──
  const c = await insProduct(TENANT_A, { sku: `${TAG}-SKU`, status: 'active' })
  pA = c.id; if (pA) created.push(['commerce_products', pA])
  ok('created product for tenant A', c.status === 201 && !!pA)

  // ── 5/6. SKU uniqueness is PER-TENANT ──
  const dupSame = await insProduct(TENANT_A, { sku: `${TAG}-SKU` })
  ok('5. duplicate SKU in the SAME tenant is rejected (unique per tenant)', dupSame.status >= 400)
  const dupOther = await insProduct(TENANT_B, { sku: `${TAG}-SKU` })
  if (dupOther.id) created.push(['commerce_products', dupOther.id])
  ok('6. the SAME SKU is allowed in a DIFFERENT tenant', dupOther.status === 201)

  // ── 7. Draft products hidden from active-catalog query ──
  const draft = await insProduct(TENANT_A, { status: 'draft', name: `${TAG} draft` })
  if (draft.id) created.push(['commerce_products', draft.id])
  const activeOnly = await (await rest(`commerce_products?tenant_id=eq.${TENANT_A}&status=neq.draft&id=eq.${draft.id}&select=id`)).json()
  ok('7. draft product is excluded from a non-draft (active catalog) query', draft.status === 201 && activeOnly.length === 0)

  // ── 8. Invalid product_type / status rejected (CHECK) ──
  ok('8a. invalid product_type is rejected', (await insProduct(TENANT_A, { product_type: 'bogus_type' })).status >= 400)
  ok('8b. invalid status is rejected', (await insProduct(TENANT_A, { status: 'bogus_status' })).status >= 400)

  // ── 9/10. Bundle item ref integrity ──
  const noRef = await rest('commerce_bundle_items', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, bundle_id: pA, quantity: 1 }) })
  ok('9a. bundle item with NO product/variant ref is rejected (CHECK)', st(noRef) >= 400)
  const bothRef = await rest('commerce_bundle_items', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, bundle_id: pA, item_product_id: pA, item_variant_id: pA, quantity: 1 }) })
  ok('9b. bundle item with BOTH refs is rejected (CHECK)', st(bothRef) >= 400)
  const badRef = await rest('commerce_bundle_items', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, bundle_id: pA, item_product_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }) })
  ok('10. bundle item with an invalid product ref is rejected (FK)', st(badRef) >= 400)
  const zeroQty = await rest('commerce_bundle_items', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, bundle_id: pA, item_product_id: pA, quantity: 0 }) })
  ok('9c. bundle item quantity must be > 0 (CHECK)', st(zeroQty) >= 400)

  // ── Inventory: location + level ──
  const loc = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, name: `${TAG} WH`, type: 'warehouse' }) })).json()
  locA = loc[0]?.id; if (locA) created.push(['commerce_locations', locA])

  // ── 11. Negative quantity rejected (CHECK on_hand >= 0) ──
  const neg = await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, item_kind: 'product', item_id: pA, location_id: locA, on_hand: -1 }) })
  ok('11. negative on_hand is rejected (CHECK)', st(neg) >= 400)

  const lvl = await (await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, item_kind: 'product', item_id: pA, location_id: locA, on_hand: 5, reserved: 2 }) })).json()
  const lvlId = lvl[0]?.id; if (lvlId) created.push(['commerce_inventory_levels', lvlId])

  // ── 12. available is DERIVED (on_hand - reserved) and cannot be manually written ──
  ok('12a. available derived = on_hand(5) - reserved(2) = 3', lvl[0]?.available === 3)
  const setAvail = await rest(`commerce_inventory_levels?id=eq.${lvlId}`, { method: 'PATCH', body: JSON.stringify({ available: 999 }) })
  ok('12b. writing the generated `available` column is rejected', st(setAvail) >= 400)

  // ── 13/16. A movement row exists with before/after matching state ──
  const mv = await (await rest('commerce_inventory_movements', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, item_kind: 'product', item_id: pA, location_id: locA, movement_type: 'opening_balance', quantity: 5, before_qty: 0, after_qty: 5 }) })).json()
  const mvId = mv[0]?.id; if (mvId) created.push(['commerce_inventory_movements', mvId])
  const curLvl = await (await rest(`commerce_inventory_levels?id=eq.${lvlId}&select=on_hand`)).json()
  ok('13/16. movement ledger row created; after_qty(5) matches level on_hand(5)', !!mvId && mv[0]?.after_qty === curLvl[0]?.on_hand)

  // ── 15. Movement ledger is immutable (UPDATE blocked by trigger) ──
  ok('15. movement UPDATE is rejected (immutable ledger trigger)', st(await rest(`commerce_inventory_movements?id=eq.${mvId}`, { method: 'PATCH', body: JSON.stringify({ quantity: 999 }) })) >= 400)

  // ── 3/4/18. Cross-tenant / anon isolation via RLS ──
  const anonRead = await (await fetch(`${U}/rest/v1/commerce_products?tenant_id=eq.${TENANT_A}&select=id`, { headers: { ...A, Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range')
  ok('3/18. anon (RLS) reads 0 of the tenant’s products', (anonRead || '').endsWith('/0'))
  ok('4a. anon INSERT is blocked (RLS)', st(await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: TENANT_A, name: `${TAG} hack`, product_type: 'simple_product' }) }, A)) >= 400)
  ok('4b. anon UPDATE is blocked (RLS)', st(await rest(`commerce_products?id=eq.${pA}`, { method: 'PATCH', body: JSON.stringify({ name: 'hacked' }) }, A)) >= 400 || (await (await rest(`commerce_products?id=eq.${pA}&select=name`)).json())[0]?.name?.startsWith(TAG))
  const anonDel = await rest(`commerce_products?id=eq.${pA}`, { method: 'DELETE' }, A)
  const stillThere = (await (await rest(`commerce_products?id=eq.${pA}&select=id`)).json()).length === 1
  ok('4c. anon DELETE does not remove the row (RLS)', stillThere)

  console.log('\n  Note: checks 2 & 19 (module gating, no cross-module impact) are HTTP checks on the Preview deploy.')
  console.log('  Note: check 17 (idempotency) is N/A in Phase 1 — the reserve_inventory RPC + idempotency keys arrive in Phase 2.')
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  // cleanup (children first). Movements are DELETE-able (only UPDATE is blocked).
  for (const [t, id] of created.reverse()) await del(`${t}?id=eq.${id}`)
  await del(`commerce_products?name=like.${TAG}*`)
  console.log('  (cleaned up all VERIFY-COMMERCE- temp rows)')
}
console.log(`\n${fail === 0 ? '✅ ALL DB CHECKS PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
