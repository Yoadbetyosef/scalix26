// Integration verification for Scalix Core Phase 5 (payments + inventory). RUN AFTER applying
// add_core_5_payments_inventory.sql.  node scripts/verify-core-phase5.mjs
// Proves: payment allocations derive paid/balance/status (deposit→partial→paid→refund), idempotent;
// inventory move is atomic (reserve reduces available, over-reserve blocked, allocate consumes, idempotent),
// ledger + levels stay consistent. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP5-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())
const list = async (p) => (await (await rest(p)).json())

let t
try {
  t = (await ins('tenants', { business_name: `${TAG}` })).id
  for (const tbl of ['payment_allocations', 'inventory_locations', 'inventory_levels', 'inventory_reservations', 'inventory_ledger']) {
    ok(`table ${tbl} exists`, (await rest(`${tbl}?select=id&limit=1`)).status === 200)
  }

  // ── payments: invoice total 100000
  const num = await rpc('core_next_document_number', { p_tenant: t, p_doc_type: 'invoice' })
  const inv = await ins('invoices', { tenant_id: t, number: num, total_cents: 100000, currency: 'usd' })
  const dep = await rpc('core_apply_payment', { p_tenant: t, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'deposit', p_amount_cents: 30000, p_currency: 'usd', p_provider_ref: null, p_key: `${TAG}-dep`, p_actor: null })
  ok('deposit → partial, balance 70000', dep.ok && dep.paid_cents === 30000 && dep.balance_cents === 70000 && dep.status === 'partial')
  const depAgain = await rpc('core_apply_payment', { p_tenant: t, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'deposit', p_amount_cents: 30000, p_currency: 'usd', p_provider_ref: null, p_key: `${TAG}-dep`, p_actor: null })
  ok('repeat deposit idempotent (still 30000)', depAgain.idempotent === true && (await list(`payment_allocations?tenant_id=eq.${t}&document_id=eq.${inv.id}&select=id`)).length === 1)
  const bal = await rpc('core_apply_payment', { p_tenant: t, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'charge', p_amount_cents: 70000, p_currency: 'usd', p_provider_ref: null, p_key: `${TAG}-bal`, p_actor: null })
  ok('remaining charge → paid, balance 0', bal.paid_cents === 100000 && bal.balance_cents === 0 && bal.status === 'paid')
  const ref = await rpc('core_apply_payment', { p_tenant: t, p_doc_type: 'invoice', p_doc_id: inv.id, p_kind: 'refund', p_amount_cents: 20000, p_currency: 'usd', p_provider_ref: null, p_key: `${TAG}-ref`, p_actor: null })
  ok('partial refund → paid 80000, status partial', ref.paid_cents === 80000 && ref.balance_cents === 20000 && ref.status === 'partial')

  // ── inventory
  const loc = await ins('inventory_locations', { tenant_id: t, name: 'WH' })
  const item = crypto.randomUUID()
  const r1 = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'receive', p_qty: 10, p_ref_type: null, p_ref_id: null, p_key: `${TAG}-rcv`, p_actor: null })
  ok('receive 10 → on_hand 10, available 10', r1.ok && Number(r1.on_hand) === 10 && Number(r1.available) === 10)
  const rcvAgain = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'receive', p_qty: 10, p_ref_type: null, p_ref_id: null, p_key: `${TAG}-rcv`, p_actor: null })
  ok('repeat receive idempotent (still 10)', rcvAgain.idempotent === true && Number((await list(`inventory_levels?tenant_id=eq.${t}&item_id=eq.${item}&select=on_hand`))[0].on_hand) === 10)
  const resv = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'reserve', p_qty: 4, p_ref_type: null, p_ref_id: null, p_key: null, p_actor: null })
  ok('reserve 4 → reserved 4, available 6', resv.ok && Number(resv.reserved) === 4 && Number(resv.available) === 6)
  const over = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'reserve', p_qty: 7, p_ref_type: null, p_ref_id: null, p_key: null, p_actor: null })
  ok('over-reserve (7 > 6 available) rejected', over.ok === false && over.error === 'insufficient_available')
  const rel = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'release', p_qty: 2, p_ref_type: null, p_ref_id: null, p_key: null, p_actor: null })
  ok('release 2 → reserved 2, available 8', Number(rel.reserved) === 2 && Number(rel.available) === 8)
  const alloc = await rpc('core_inventory_move', { p_tenant: t, p_kind: 'product', p_item: item, p_location: loc.id, p_movement: 'allocate', p_qty: 2, p_ref_type: null, p_ref_id: null, p_key: null, p_actor: null })
  ok('allocate 2 → reserved 0, on_hand 8', Number(alloc.reserved) === 0 && Number(alloc.on_hand) === 8)
  ok('every move recorded in the ledger', (await list(`inventory_ledger?tenant_id=eq.${t}&item_id=eq.${item}&select=id`)).length >= 4)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenant via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 5 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
