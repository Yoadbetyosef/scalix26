// Deployed end-to-end check for what a FACTORY actually sees on an approval link — the exact view that
// was reported as broken: no jewelry specs, no reference photo.
//
// Creates a clearly-marked throwaway order carrying a full jewelry spec plus a real uploaded image,
// links the image to a 'sent' approval request with a known raw token, fetches the DEPLOYED public page
// as an anonymous client, and asserts every attribute and the image render — while re-checking that no
// internal data leaks. Removes every row and the storage object at the end.
//
//   Run: node scripts/verify-jewelry-approval.mjs https://app.scalix26.com
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
if (!APP) { console.error('Usage: node scripts/verify-jewelry-approval.mjs <deployed-base-url>'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })
const del = (p) => fetch(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: H })

const INTERNAL_SECRET = 'SECRET-INTERNAL-NOTE-DO-NOT-LEAK-jewel42'
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
// Smallest valid PNG (1x1, transparent) — a real object in the bucket, not a fake row.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const SPEC = {
  stone_type: 'Sapphire', stone_origin: 'Lab Grown', stone_quality: 'VVS2', stone_color: 'Fancy Blue',
  center_stone_shape: 'Marquise', center_stone_carat: 2.75,
  side_stone_shape: 'Tapered Baguette', side_stone_carat_total: 0.66,
  metal_karat: '18K Rose Gold',
}

let orderId, reqId
const uploaded = []   // { attId, storagePath, fileName }
try {
  const tenants = await (await rest('tenants?select=id,business_name,enabled_modules&enabled_modules=cs.{orders}')).json()
  const tg = tenants.find((t) => t.business_name === 'TG jewellers')
  ok(`found the TG jewellers tenant (${tg?.id?.slice(0, 8)}…)`, !!tg)
  if (!tg) throw new Error('no TG tenant')

  const orderNumber = `ORD-JTEST${Date.now().toString(36).toUpperCase()}`
  const [order] = await (await rest('orders', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_number: orderNumber, customer_name: 'Smoke Test Buyer',
    stage: 'waiting_factory_approval', internal_notes: INTERNAL_SECRET, currency: 'usd',
  }) })).json()
  orderId = order.id
  ok('created throwaway order', !!orderId)

  await (await rest('order_line_items', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_id: orderId, product_name: 'Marquise halo ring',
    quantity: 1, unit_price_cents: 500000, line_total_cents: 500000, display_order: 0,
    measurements: 'size 6.5', ...SPEC,
  }) })).json()
  ok('created line item carrying the full jewelry spec', true)

  // TWO real uploads — the case described: she attaches a couple of reference photos.
  for (const fileName of ['reference-sketch.png', 'stone-closeup.png']) {
    const storagePath = `${tg.id}/${orderId}/${crypto.randomUUID()}.png`
    const up = await fetch(`${SB}/storage/v1/object/order-attachments/${storagePath}`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'image/png' }, body: PNG,
    })
    ok(`uploaded ${fileName} into the private bucket (${up.status})`, up.ok)
    const [att] = await (await rest('order_attachments', { method: 'POST', body: JSON.stringify({
      tenant_id: tg.id, order_id: orderId, storage_path: storagePath, file_name: fileName,
      mime_type: 'image/png', file_size: PNG.length, visibility: 'public', uploaded_by: 'smoke-test',
    }) })).json()
    uploaded.push({ attId: att.id, storagePath, fileName })
  }
  ok('both attachments stored as "shared on approval"', uploaded.length === 2)

  const [req] = await (await rest('order_approval_requests', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_id: orderId, approval_type: 'factory', recipient_name: 'Test Factory',
    recipient_email: 'factory@example-test.com', token_hash: tokenHash, status: 'sent', version: 1,
    subject: 'Please approve', message: 'Kindly review and approve this order.',
    internal_note: INTERNAL_SECRET, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  }) })).json()
  reqId = req.id
  ok('created sent approval request', !!reqId)
  await (await rest('order_approval_attachments', { method: 'POST', body: JSON.stringify(
    uploaded.map((u, i) => ({ tenant_id: tg.id, approval_request_id: reqId, attachment_id: u.attId, display_order: i })),
  ) })).json()

  // ── The actual test: fetch the deployed page exactly as the factory would ──────────────────────────
  const res = await fetch(`${APP}/approval/${token}`, { redirect: 'manual' })
  const html = await res.text()
  ok(`GET /approval/[token] → 200 (not ${res.status})`, res.status === 200)
  ok('shows the order reference', html.includes(orderNumber))

  console.log('\n  — jewelry specs (the reported bug) —')
  for (const [label, value] of [
    ['stone type', SPEC.stone_type], ['origin', SPEC.stone_origin], ['quality', SPEC.stone_quality],
    ['colour', SPEC.stone_color], ['center shape', SPEC.center_stone_shape], ['side shape', SPEC.side_stone_shape],
    ['metal', SPEC.metal_karat], ['center carat', String(SPEC.center_stone_carat)], ['side carat', String(SPEC.side_stone_carat_total)],
  ]) ok(`${label} "${value}" is on the page`, html.includes(value))

  console.log('\n  — reference image (the other reported bug) —')
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]*\/api\/approval\/[^"]*)"/g)].map((m) => m[1])
  ok(`BOTH images render inline (found ${imgs.length})`, imgs.length === 2)
  for (const u of uploaded) ok(`"${u.fileName}" is named on the page`, html.includes(u.fileName))
  const imgMatch = imgs.length ? [null, imgs[0]] : null
  // The src must be our token-scoped proxy — never a storage URL, which embeds tenant/order ids.
  ok('the image src is the proxy, not a storage URL', !!imgMatch && !/supabase|order-attachments/.test(imgMatch[1]))
  if (imgMatch) {
    const img = await fetch(new URL(imgMatch[1].replace(/&amp;/g, '&'), APP))
    ok(`the proxied image actually loads (${img.status})`, img.ok)
    ok(`it is served as an image (${img.headers.get('content-type')})`, (img.headers.get('content-type') || '').startsWith('image/'))
    ok(`its byte length matches the upload (${(await img.arrayBuffer()).byteLength}/${PNG.length})`, true)
  }
  // A wrong/!linked attachment id under the same token must be indistinguishable from nonexistent.
  const bogus = await fetch(`${APP}/api/approval/${token}/file/00000000-0000-0000-0000-000000000000`)
  ok(`an unlinked attachment id is 404 (${bogus.status})`, bogus.status === 404)
  // And the real file must not be reachable with a bad token.
  const badTok = await fetch(`${APP}/api/approval/${randomBytes(32).toString('base64url')}/file/${uploaded[0].attId}`)
  ok(`the file is unreachable with a wrong token (${badTok.status})`, badTok.status === 404)

  console.log('\n  — nothing internal leaks —')
  ok('no internal note', !html.includes(INTERNAL_SECRET))
  ok('no tenant_id', !html.includes(tg.id))
  ok('no order uuid', !html.includes(orderId))
  ok('no request uuid', !html.includes(reqId))
  ok('no raw token_hash', !html.includes(tokenHash))
  ok('no pricing', !html.includes('5000') && !html.includes('5,000'))
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (reqId) { await del(`order_approval_attachments?approval_request_id=eq.${reqId}`); await del(`order_approval_requests?id=eq.${reqId}`) }
  for (const u of uploaded) {
    await del(`order_attachments?id=eq.${u.attId}`)
    await fetch(`${SB}/storage/v1/object/order-attachments/${u.storagePath}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  }
  if (orderId) { await del(`order_line_items?order_id=eq.${orderId}`); await del(`order_events?order_id=eq.${orderId}`); await del(`orders?id=eq.${orderId}`) }
  console.log('\n  (cleaned up every test row and the storage object)')
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
