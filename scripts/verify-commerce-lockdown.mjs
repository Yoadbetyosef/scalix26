// Verifies the Phase 1c inventory lockdown against the REAL database, using a genuine `authenticated`
// tenant client (a throwaway user we create + sign in via password grant). RUN AFTER applying
// add_commerce_3_inventory_lockdown.sql. Proves: a direct authenticated UPDATE to reserved/on_hand is
// rejected AND leaves the value unchanged; reads still work; the approved service-role path still writes
// and creates exactly one movement; cross-tenant still holds. All temp rows prefixed VERIFY-COMMERCE-.
//   node scripts/verify-commerce-lockdown.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY, AK = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TENANT_A = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
const TAG = 'VERIFY-COMMERCE-' + Date.now()
const EMAIL = `${TAG.toLowerCase()}@example.com`.replace(/_/g, '-'), PW = 'Verify!' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}, h = S) => fetch(`${U}/rest/v1/${p}`, { headers: h, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const readReserved = async (id) => (await (await rest(`commerce_inventory_levels?id=eq.${id}&select=reserved,on_hand`)).json())[0]

let userId, tenantId, locId, lvlId
try {
  // Throwaway authenticated user + its own tenant + an inventory level.
  const u = await (await fetch(`${U}/auth/v1/admin/users`, { method: 'POST', headers: S, body: JSON.stringify({ email: EMAIL, password: PW, email_confirm: true }) })).json()
  userId = u.id
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: `${TAG} tenant`, user_id: userId }) })).json()
  tenantId = t.id
  const [loc] = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} WH`, type: 'warehouse' }) })).json()
  locId = loc.id
  const [p] = await (await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} item`, product_type: 'simple_product' }) })).json()
  const [lvl] = await (await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: p.id, location_id: locId, on_hand: 5, reserved: 1 }) })).json()
  lvlId = lvl.id
  ok('set up throwaway authenticated user + tenant + inventory level (reserved=1, on_hand=5)', !!userId && !!tenantId && !!lvlId)

  // Sign in as the throwaway user → real `authenticated` JWT.
  const tok = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: AK, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()
  const AUTH = { apikey: AK, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json', Prefer: 'return=representation' }
  ok('signed in as the tenant user (authenticated JWT obtained)', !!tok.access_token)

  // 1. Authenticated client cannot read? It CAN read (SELECT preserved) — its own tenant's level.
  const readable = await (await fetch(`${U}/rest/v1/commerce_inventory_levels?id=eq.${lvlId}&select=id,reserved`, { headers: AUTH })).json()
  ok('read access preserved: authenticated client can SELECT its own level', Array.isArray(readable) && readable.length === 1)

  // 2. Authenticated UPDATE to reserved is rejected AND leaves the value unchanged.
  const upRes = await fetch(`${U}/rest/v1/commerce_inventory_levels?id=eq.${lvlId}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ reserved: 99 }) })
  const afterR = await readReserved(lvlId)
  ok(`authenticated UPDATE reserved rejected (status ${upRes.status}) AND reserved unchanged (=${afterR?.reserved})`, upRes.status >= 400 && afterR?.reserved === 1)

  // 3. Authenticated UPDATE to on_hand is rejected AND unchanged.
  const upOh = await fetch(`${U}/rest/v1/commerce_inventory_levels?id=eq.${lvlId}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ on_hand: 99 }) })
  const afterOh = await readReserved(lvlId)
  ok(`authenticated UPDATE on_hand rejected (status ${upOh.status}) AND on_hand unchanged (=${afterOh?.on_hand})`, upOh.status >= 400 && afterOh?.on_hand === 5)

  // 4. Authenticated INSERT of a movement is rejected too (can't fabricate ledger).
  const insMv = await fetch(`${U}/rest/v1/commerce_inventory_movements`, { method: 'POST', headers: AUTH, body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: p.id, location_id: locId, movement_type: 'manual_adjustment', quantity: 10 }) })
  ok(`authenticated INSERT into movement ledger rejected (status ${insMv.status})`, insMv.status >= 400)

  // 5. Approved service-role path still updates inventory + writes exactly one movement.
  await rest(`commerce_inventory_levels?id=eq.${lvlId}`, { method: 'PATCH', body: JSON.stringify({ reserved: 3 }) })
  await rest('commerce_inventory_movements', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: p.id, location_id: locId, movement_type: 'reservation', quantity: 2, before_qty: 1, after_qty: 3 }) })
  const svcAfter = await readReserved(lvlId)
  const mvCount = Number(((await (await rest(`commerce_inventory_movements?item_id=eq.${p.id}&select=id`, { headers: { ...S, Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range')) || '').split('/')[1] || 0)
  ok('approved (service-role) path updates reserved to 3', svcAfter?.reserved === 3)
  ok('exactly one immutable movement row created via the approved path', mvCount === 1)

  // 6. Cross-tenant: this authenticated user cannot read tenant A's products.
  const crossRead = await fetch(`${U}/rest/v1/commerce_products?tenant_id=eq.${TENANT_A}&select=id`, { headers: { ...AUTH, Prefer: 'count=exact', Range: '0-0' } })
  ok('cross-tenant read blocked (RLS) for the authenticated user', (crossRead.headers.get('content-range') || '').endsWith('/0'))
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) { await del(`commerce_inventory_movements?tenant_id=eq.${tenantId}`); await del(`commerce_inventory_levels?tenant_id=eq.${tenantId}`); await del(`commerce_locations?tenant_id=eq.${tenantId}`); await del(`commerce_products?tenant_id=eq.${tenantId}`); await del(`tenants?id=eq.${tenantId}`) }
  if (userId) await fetch(`${U}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: S })
  console.log('  (cleaned up throwaway user, tenant, and all VERIFY-COMMERCE- rows)')
}
console.log(`\n${fail === 0 ? '✅ LOCKDOWN VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
