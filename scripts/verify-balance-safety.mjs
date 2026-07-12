// Live integration test for the balance-safe apply_balance_txn RPC.
// Proves: exact-balance→0, insufficient→rejected/unchanged, concurrent double-spend prevention,
// duplicate idempotency, and credit-after-failure restore. Uses a throwaway test partner and
// resets state between scenarios + cleans up at the end.
//   Run: node scripts/verify-balance-safety.mjs [partner_uuid]
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const BASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
const P = process.argv[2] || '91101ffb-9d52-41c0-a784-527e0d509b8e' // Nature Sparkle test partner
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const K = Date.now().toString(36)
let pass = 0, fail = 0
const ok = (desc, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${desc}`); cond ? pass++ : fail++ }

const rpc = (body) => fetch(`${BASE}/rest/v1/rpc/apply_balance_txn`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json())
const del = (path) => fetch(`${BASE}/rest/v1/${path}`, { method: 'DELETE', headers: H })
const reset = async () => { await del(`partner_balance_transactions?partner_id=eq.${P}`); await del(`partner_balances?partner_id=eq.${P}`) }
const wallet = async () => (await (await fetch(`${BASE}/rest/v1/partner_balances?select=balance_cents,status&partner_id=eq.${P}`, { headers: H })).json())[0] || {}
const usageRows = async () => (await (await fetch(`${BASE}/rest/v1/partner_balance_transactions?select=id&type=eq.usage&partner_id=eq.${P}`, { headers: H })).json()).length
const credit = (amt, key) => rpc({ p_partner_id: P, p_type: 'top_up', p_amount_cents: amt, p_idempotency_key: key })
const debit = (amt, key) => rpc({ p_partner_id: P, p_type: 'usage', p_amount_cents: -amt, p_idempotency_key: key, p_category: 'ai' })

console.log(`\nBalance-safety verification (partner ${P.slice(0, 8)}…)\n`)

// A — exact-balance debit → balance zero, paused
await reset(); await credit(5000, `${K}-a-c`)
{ const r = await debit(5000, `${K}-a-d`); const w = await wallet()
  ok('exact-balance debit applies', r.applied === true && r.result === 'applied')
  ok('exact-balance leaves balance 0', Number(w.balance_cents) === 0)
  ok('exact-balance sets status paused', w.status === 'paused') }

// B — insufficient debit → rejected, balance unchanged, no ledger row, payment_required
await reset(); await credit(5000, `${K}-b-c`)
{ const r = await debit(6000, `${K}-b-d`); const w = await wallet()
  ok('insufficient debit rejected', r.applied === false && r.result === 'insufficient_balance')
  ok('insufficient reports shortfall 1000', Number(r.shortfall_cents) === 1000)
  ok('insufficient leaves balance unchanged (5000)', Number(w.balance_cents) === 5000)
  ok('insufficient sets status payment_required', w.status === 'payment_required')
  ok('insufficient inserted NO usage ledger row', (await usageRows()) === 0) }

// C — concurrency: balance 5000, FOUR parallel debits of 4000 → exactly one applies, final 1000, one row
await reset(); await credit(5000, `${K}-c-c`)
{ const results = await Promise.all([0, 1, 2, 3].map((i) => debit(4000, `${K}-c-d${i}`)))
  const applied = results.filter((r) => r.applied === true).length
  const insuff = results.filter((r) => r.result === 'insufficient_balance').length
  const w = await wallet()
  ok('concurrent: exactly ONE debit applied', applied === 1)
  ok('concurrent: the other three insufficient', insuff === 3)
  ok('concurrent: final balance 1000 (no double-spend)', Number(w.balance_cents) === 1000)
  ok('concurrent: exactly one usage ledger row', (await usageRows()) === 1) }

// D — duplicate idempotency key → charged once
await reset(); await credit(5000, `${K}-d-c`)
{ const r1 = await debit(1000, `${K}-d-dup`); const r2 = await debit(1000, `${K}-d-dup`); const w = await wallet()
  ok('duplicate: first applies', r1.applied === true)
  ok('duplicate: second is a no-op', r2.applied === false && r2.duplicate === true)
  ok('duplicate: charged exactly once (balance 4000)', Number(w.balance_cents) === 4000) }

// E — credit after payment failure restores service
await reset(); await credit(5000, `${K}-e-c1`)
{ await debit(6000, `${K}-e-over`); const w0 = await wallet()
  await credit(5000, `${K}-e-c2`); const w = await wallet()
  ok('after failure status is payment_required', w0.status === 'payment_required')
  ok('credit restores status active', w.status === 'active')
  ok('credit restores balance (10000)', Number(w.balance_cents) === 10000) }

await reset()
console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
