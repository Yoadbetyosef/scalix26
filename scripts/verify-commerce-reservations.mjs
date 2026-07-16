// Real-DB verification for Commerce Phase 2 reservations. RUN AFTER applying
// add_commerce_4_projects_drafts.sql + add_commerce_5_reservations.sql.
// Proves: NO OVERSELL under concurrency (two simultaneous reserves of the last unit), idempotency,
// insufficient-stock shortfall detail, auto-expiry release, adding a draft item does NOT reserve, and
// draft version-conflict detection. Uses the service-role RPCs (the app's approved path). Cleans up.
//   node scripts/verify-commerce-reservations.mjs
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
const reserved = async (lvlId) => Number((await (await rest(`commerce_inventory_levels?id=eq.${lvlId}&select=reserved`)).json())[0]?.reserved)

let tenantId, pId, locId, lvlId, draftId
try {
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: `${TAG} tenant` }) })).json(); tenantId = t.id
  const [p] = await (await rest('commerce_products', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} item`, product_type: 'simple_product' }) })).json(); pId = p.id
  const [loc] = await (await rest('commerce_locations', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: `${TAG} WH`, type: 'warehouse' }) })).json(); locId = loc.id
  const [lvl] = await (await rest('commerce_inventory_levels', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, item_kind: 'product', item_id: pId, location_id: locId, on_hand: 1, reserved: 0 }) })).json(); lvlId = lvl.id
  const [d] = await (await rest('commerce_drafts', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, draft_number: `${TAG}-D`, name: 'draft' }) })).json(); draftId = d.id
  ok('set up tenant + product + location + level(on_hand=1) + draft', !!lvlId && !!draftId)

  // (a) Adding a draft item does NOT reserve inventory (§5).
  await rest('commerce_draft_items', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, draft_id: draftId, line_kind: 'product', product_id: pId, quantity: 1, unit_price_cents: 500000 }) })
  ok('adding a draft item does NOT change reserved (still 0)', (await reserved(lvlId)) === 0)

  // (b) NO OVERSELL under concurrency: two simultaneous reserves of the LAST unit → exactly one succeeds.
  const args = (key) => ({ p_tenant: tenantId, p_item_kind: 'product', p_item_id: pId, p_location_id: locId, p_qty: 1, p_draft_id: draftId, p_order_id: null, p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_idempotency_key: key, p_created_by: 'verify' })
  const [r1, r2] = await Promise.all([rpc('reserve_inventory', args(`${TAG}-k1`)), rpc('reserve_inventory', args(`${TAG}-k2`))])
  const okCount = [r1, r2].filter((r) => r.ok).length
  const failR = [r1, r2].find((r) => !r.ok)
  ok('exactly ONE of two concurrent reserves of the last unit succeeds (no oversell)', okCount === 1)
  ok('reserved ended at 1 (not 2) — last unit not oversold', (await reserved(lvlId)) === 1)
  ok('the failed reserve reports insufficient shortfall (requested/available/missing)', failR && failR.error === 'insufficient' && failR.requested === 1 && failR.available === 0 && failR.missing === 1)

  // (c) Idempotency: repeating the WINNING key does not reserve again.
  const winKey = r1.ok ? `${TAG}-k1` : `${TAG}-k2`
  const again = await rpc('reserve_inventory', args(winKey))
  ok('repeating an idempotent reserve does not double-apply', again.ok === true && again.idempotent === true && (await reserved(lvlId)) === 1)

  // (d) Auto-expiry: back-date the reservation and run the expire function → released, reserved→0.
  const winId = (r1.ok ? r1 : r2).reservation_id
  await rest(`commerce_reservations?id=eq.${winId}`, { method: 'PATCH', body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) })
  const releasedN = await rpc('expire_commerce_reservations', {})
  ok('expire_commerce_reservations released the past-due reservation', Number(releasedN) >= 1)
  ok('reserved returned to 0 after expiry', (await reserved(lvlId)) === 0)
  const st = (await (await rest(`commerce_reservations?id=eq.${winId}&select=status`)).json())[0]?.status
  ok('reservation status is now expired', st === 'expired')

  // (e) Draft version conflict: an update with a stale version affects 0 rows.
  const curVer = (await (await rest(`commerce_drafts?id=eq.${draftId}&select=version`)).json())[0]?.version
  const staleUpd = await (await rest(`commerce_drafts?id=eq.${draftId}&version=eq.999`, { method: 'PATCH', body: JSON.stringify({ name: 'stale' }) })).json()
  ok('stale-version draft update affects 0 rows (conflict detectable)', Array.isArray(staleUpd) && staleUpd.length === 0)
  const freshUpd = await (await rest(`commerce_drafts?id=eq.${draftId}&version=eq.${curVer}`, { method: 'PATCH', body: JSON.stringify({ version: curVer + 1 }) })).json()
  ok('current-version draft update succeeds', Array.isArray(freshUpd) && freshUpd.length === 1)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) await del(`tenants?id=eq.${tenantId}`) // CASCADE removes all commerce_* rows for the tenant
  console.log('  (cleaned up throwaway tenant + all VERIFY-COMMERCE- rows via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ RESERVATIONS VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
