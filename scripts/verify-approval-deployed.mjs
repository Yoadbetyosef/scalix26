// Deployed happy-path smoke test for the PUBLIC external-approval page.
// Inserts a clearly-marked throwaway order + a 'sent' factory approval request (known raw token)
// against the shared DB, hits the DEPLOYED /approval/[token] URL as an anonymous client, and asserts
// the safe projection renders (order ref + action) while internal-only data (internal note, tenant_id,
// raw uuids, recipient email of others) never leaks. Cleans up all rows at the end.
//   Run: node scripts/verify-approval-deployed.mjs <deployed-base-url>
import { readFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const APP = (process.argv[2] || '').replace(/\/$/, '')
if (!APP) { console.error('Usage: node scripts/verify-approval-deployed.mjs <deployed-base-url>'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })
const del = (p) => fetch(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: H })

const INTERNAL_SECRET = 'SECRET-INTERNAL-NOTE-DO-NOT-LEAK-xyz789'
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')

let orderId, reqId
try {
  // Tatiana's tenant — resolve as the ONLY tenant with orders enabled (never guess by name alone).
  const tenants = await (await rest(`tenants?select=id,business_name,enabled_modules&enabled_modules=cs.{orders}`)).json()
  ok(`exactly one tenant has orders enabled (${tenants.length})`, tenants.length === 1)
  const tg = tenants[0]
  ok(`it is TG jewellers (${tg?.id?.slice(0, 8)}…)`, tg?.business_name === 'TG jewellers')
  if (!tg) throw new Error('no TG tenant')

  const orderNumber = `ORD-TEST${Date.now().toString(36).toUpperCase()}`
  const [order] = await (await rest('orders', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_number: orderNumber, customer_name: 'Smoke Test Buyer',
    stage: 'waiting_factory_approval', internal_notes: INTERNAL_SECRET, currency: 'GBP',
  }) })).json()
  orderId = order.id
  ok('created throwaway order', !!orderId)

  const [req] = await (await rest('order_approval_requests', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_id: orderId, approval_type: 'factory', recipient_name: 'Test Factory',
    recipient_email: 'factory@example-test.com', token_hash: tokenHash, status: 'sent', version: 1,
    subject: 'Please approve', message: 'Kindly review and approve this order.',
    internal_note: INTERNAL_SECRET, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  }) })).json()
  reqId = req.id
  ok('created sent approval request (known token, hash-only stored)', !!reqId)

  // Anonymous fetch of the deployed public page.
  const res = await fetch(`${APP}/approval/${token}`, { redirect: 'manual' })
  const html = await res.text()
  ok(`GET /approval/[valid] → 200 (not ${res.status} redirect)`, res.status === 200)
  ok('page shows the order reference', html.includes(orderNumber))
  ok('page shows the requested action (approve/review)', /approv|review/i.test(html))
  ok('page does NOT leak the internal note', !html.includes(INTERNAL_SECRET))
  ok('page does NOT leak the tenant_id', !html.includes(tg.id))
  ok('page does NOT leak the order uuid', !html.includes(orderId))
  ok('page does NOT leak the request uuid', !html.includes(reqId))
  ok('page does NOT leak the raw token_hash', !html.includes(tokenHash))
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (reqId) await del(`order_approval_requests?id=eq.${reqId}`)
  if (orderId) { await del(`order_events?order_id=eq.${orderId}`); await del(`orders?id=eq.${orderId}`) }
  console.log('  (cleaned up test rows)')
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
