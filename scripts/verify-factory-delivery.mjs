// Deployed integration test for the PUBLIC factory "ready + invoice" hand-off.
// Seeds a throwaway order in `production` with a factory approval token, then POSTs an invoice to the
// deployed /api/approval/[token]/delivery endpoint as an anonymous client, and asserts:
//   • order moves production → ready
//   • an INTERNAL 'factory' attachment is created (invoice), never public
//   • a 'factory_ready' timeline event is logged
//   • a second submit is rejected (order no longer in production) — no double hand-off
//   • a non-production order rejects the upload
// Cleans up all rows + storage at the end.
//   Run: node scripts/verify-factory-delivery.mjs <deployed-base-url>
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
if (!APP) { console.error('Usage: node scripts/verify-factory-delivery.mjs <deployed-base-url>'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })
const del = (p) => fetch(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: H })

const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')

let orderId, reqId, tgId
try {
  const [tg] = await (await rest(`tenants?select=id,business_name&enabled_modules=cs.{orders}`)).json()
  ok(`resolved TG jewellers (${tg?.id?.slice(0, 8)}…)`, tg?.business_name === 'TG jewellers')
  tgId = tg.id

  const [order] = await (await rest('orders', { method: 'POST', body: JSON.stringify({
    tenant_id: tgId, order_number: `ORD-DLV${Date.now().toString(36).toUpperCase()}`, customer_name: 'Delivery Test', stage: 'production', currency: 'GBP',
  }) })).json()
  orderId = order.id
  const [req] = await (await rest('order_approval_requests', { method: 'POST', body: JSON.stringify({
    tenant_id: tgId, order_id: orderId, approval_type: 'factory', recipient_email: 'factory@example-test.com',
    token_hash: tokenHash, status: 'approved', version: 1, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  }) })).json()
  reqId = req.id
  ok('seeded production order + approved factory token', !!orderId && !!reqId)

  // Anonymous multipart upload to the deployed endpoint.
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 fake invoice')], { type: 'application/pdf' }), 'invoice.pdf')
  const res = await fetch(`${APP}/api/approval/${token}/delivery`, { method: 'POST', body: fd })
  ok(`POST delivery → 200 (got ${res.status})`, res.status === 200)

  const [after] = await (await rest(`orders?select=stage&id=eq.${orderId}`)).json()
  ok('order moved production → ready', after?.stage === 'ready')

  const atts = await (await rest(`order_attachments?select=uploaded_by,visibility,file_name,storage_path&order_id=eq.${orderId}`)).json()
  ok('exactly one invoice attachment created', atts.length === 1)
  ok("attachment is uploaded_by 'factory'", atts[0]?.uploaded_by === 'factory')
  ok('attachment is INTERNAL (never public)', atts[0]?.visibility === 'internal')

  const events = await (await rest(`order_events?select=type,actor&order_id=eq.${orderId}&type=eq.factory_ready`)).json()
  ok("'factory_ready' timeline event logged by factory", events.length === 1 && events[0]?.actor === 'factory')

  // Second submit must be rejected — order is no longer in production.
  const fd2 = new FormData()
  fd2.append('file', new Blob([Buffer.from('%PDF-1.4 second')], { type: 'application/pdf' }), 'invoice2.pdf')
  const res2 = await fetch(`${APP}/api/approval/${token}/delivery`, { method: 'POST', body: fd2 })
  ok(`second submit rejected (got ${res2.status})`, res2.status === 400)
  const atts2 = await (await rest(`order_attachments?select=id&order_id=eq.${orderId}`)).json()
  ok('no duplicate attachment from the rejected submit', atts2.length === 1)

  // Cleanup storage for the created attachment(s).
  for (const a of atts) await fetch(`${SB}/storage/v1/object/order-attachments/${a.storage_path}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (orderId) await del(`order_attachments?order_id=eq.${orderId}`)
  if (reqId) await del(`order_approval_requests?id=eq.${reqId}`)
  if (orderId) { await del(`order_events?order_id=eq.${orderId}`); await del(`orders?id=eq.${orderId}`) }
  console.log('  (cleaned up test rows + storage)')
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
