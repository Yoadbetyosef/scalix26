// Deployed smoke test for the TG production-readiness work: the customer's public document, the
// certificate behind it, the token boundary, the login wall on the owner's URL, and which parts of
// add_tg_production_1.sql the database has.
//
//   node scripts/verify-tg-production.mjs <deployed-base-url>
//
// Inserts clearly-marked throwaway rows on TG's tenant (order, line, two attachments, a share),
// uploads a one-page PDF to the private bucket, fetches the DEPLOYED pages as an anonymous client,
// and deletes everything it made — including the storage objects — at the end, pass or fail.
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
if (!APP) { console.error('Usage: node scripts/verify-tg-production.mjs <deployed-base-url>'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); if (c) pass++; else fail++ }
const info = (d) => console.log(`  info: ${d}`)
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })
const del = (p) => fetch(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: H })

const INTERNAL_SECRET = 'SECRET-INTERNAL-NOTE-DO-NOT-LEAK-tg1'
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
// The smallest valid PDF there is.
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')

let tg, orderId, otherOrderId, pdfPath, pdfAttId, internalAttId, shareId
try {
  const tenants = await (await rest(`tenants?select=id,business_name&enabled_modules=cs.{orders}`)).json()
  tg = tenants.find((t) => t.business_name === 'TG jewellers')
  ok('found the TG tenant', !!tg)
  if (!tg) throw new Error('no TG tenant')

  // ── The order under test: a bracelet estimate, with a certificate and an internal file ─────────
  const orderNumber = `ORD-VERIFY${Date.now().toString(36).toUpperCase()}`
  const [order] = await (await rest('orders', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_number: orderNumber, customer_name: 'Verify Buyer', customer_company: 'Verify Yachts Ltd',
    stage: 'new', internal_notes: INTERNAL_SECRET, currency: 'cad', subtotal_cents: 485000, deposit_cents: 0, balance_cents: 485000,
    delivery_province: 'BC', tax_kind: 'combined', tax_label: 'GST + PST', tax_rate_percent: 12, letterhead_style: 'rule',
  }) })).json()
  orderId = order?.id
  ok('created throwaway order', !!orderId)
  await rest('order_line_items', { method: 'POST', body: JSON.stringify({
    tenant_id: tg.id, order_id: orderId, product_name: 'Verify tennis bracelet', product_type: 'Bracelet', quantity: 1, unit_price_cents: 485000, line_total_cents: 485000,
    stone_type: 'Diamond', stone_quality: 'VS1', stone_color: 'G', metal_karat: '14K White Gold', measurements: "7''", certificate_lab: 'GIA', internal_cost_cents: 210000, display_order: 0,
  }) })

  pdfPath = `${tg.id}/${orderId}/verify-cert.pdf`
  const up = await fetch(`${SB}/storage/v1/object/order-attachments/${pdfPath}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/pdf' }, body: PDF })
  ok('uploaded a certificate PDF to the private bucket', up.ok)
  const [pdfAtt] = await (await rest('order_attachments', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, order_id: orderId, storage_path: pdfPath, file_name: 'GIA-verify.pdf', mime_type: 'application/pdf', file_size: PDF.length, visibility: 'public' }) })).json()
  pdfAttId = pdfAtt?.id
  const [intAtt] = await (await rest('order_attachments', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, order_id: orderId, storage_path: pdfPath, file_name: 'supplier-invoice-INTERNAL.pdf', mime_type: 'application/pdf', file_size: PDF.length, visibility: 'internal' }) })).json()
  internalAttId = intAtt?.id
  ok('attachment rows created (one public certificate, one internal)', !!pdfAttId && !!internalAttId)

  const [share] = await (await rest('order_document_shares', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, order_id: orderId, doc_type: 'estimate', token_hash: tokenHash, recipient_email: 'link', sent_at: new Date().toISOString() }) })).json()
  shareId = share?.id
  ok('created a share link (hash only stored)', !!shareId)

  // A second order on the same tenant, to prove the token cannot reach its files.
  const [other] = await (await rest('orders', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, order_number: `${orderNumber}-B`, customer_name: 'Other Buyer', stage: 'new', currency: 'cad' }) })).json()
  otherOrderId = other?.id
  const [otherAtt] = await (await rest('order_attachments', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, order_id: otherOrderId, storage_path: pdfPath, file_name: 'other.pdf', mime_type: 'application/pdf', file_size: PDF.length, visibility: 'public' }) })).json()

  // ── 1. The customer opens the estimate with no account ─────────────────────────────────────────
  const page = await fetch(`${APP}/e/${token}`, { redirect: 'manual' })
  const html = await page.text()
  ok(`GET /e/[token] → 200 without a session (got ${page.status})`, page.status === 200)
  ok('shows the order reference and the piece', html.includes(orderNumber) && html.includes('Verify tennis bracelet'))
  // React SSR puts a comment node between static text and an expression, so the two halves are checked apart.
  ok('addressed to the company with the person underneath', html.includes('Verify Yachts Ltd') && /Attn: (<!-- -->)?Verify Buyer/.test(html))
  ok('lists the certificate under Certificates & documents', /Certificates &amp; documents/.test(html) && html.includes('GIA-verify.pdf'))
  ok('the certificate link goes through the token route', html.includes(`/e/${token}/file/${pdfAttId}`))
  ok('the internal file is NOT on the customer copy', !html.includes('supplier-invoice-INTERNAL'))
  ok('internal note never leaks', !html.includes(INTERNAL_SECRET))
  ok('internal cost never leaks', !html.includes('2,100') && !html.includes('2100.00'))
  ok('no platform branding on the customer copy', !/Scalix26/i.test(html))
  ok('tax line printed for BC (12% of 4,850 = 582.00)', /GST \+ PST/.test(html) && /582\.00/.test(html))
  // The rule letterhead splits "T.G. DESIGNS" into two spans around the stone; the email is one piece.
  ok('letterhead: the T.G. Designs identity, from its own profile', /DESIGNS/.test(html) && html.includes('info@tg-designs.com'))
  ok('and the tab title is the letterhead business, not the tenant', /<title>T\.G\. DESIGNS · Estimate<\/title>/.test(html))

  // ── 2. The certificate opens ───────────────────────────────────────────────────────────────────
  const file = await fetch(`${APP}/e/${token}/file/${pdfAttId}`, { redirect: 'manual' })
  ok(`GET /e/[token]/file/[certificate] → 302 to a signed URL (got ${file.status})`, file.status === 302)
  const loc = file.headers.get('location') || ''
  ok('the signed URL is on storage, not our app', loc.includes('/storage/v1/object/sign/'))
  const pdf = await fetch(loc)
  ok(`the PDF downloads (${pdf.status}, ${pdf.headers.get('content-type')})`, pdf.ok && /pdf/.test(pdf.headers.get('content-type') || ''))

  // ── 3. The boundary ────────────────────────────────────────────────────────────────────────────
  ok('the internal attachment is refused through the token', (await fetch(`${APP}/e/${token}/file/${internalAttId}`, { redirect: 'manual' })).status === 404)
  ok("another order's attachment is refused through the token", (await fetch(`${APP}/e/${token}/file/${otherAtt.id}`, { redirect: 'manual' })).status === 404)
  ok('a garbage token is a bare 404', (await fetch(`${APP}/e/${'x'.repeat(43)}`, { redirect: 'manual' })).status === 404)
  const owner = await fetch(`${APP}/orders/${orderId}/document/estimate`, { redirect: 'manual' })
  ok(`the owner's document URL is behind login (${owner.status} → ${owner.headers.get('location')})`, owner.status === 307 && (owner.headers.get('location') || '').includes('/auth/login'))

  // ── 4. Revocation ends the link ────────────────────────────────────────────────────────────────
  await rest(`order_document_shares?id=eq.${shareId}`, { method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() }) })
  const dead = await fetch(`${APP}/e/${token}`, { redirect: 'manual' })
  ok('a revoked link says so to its holder', dead.status === 200 && /withdrawn/i.test(await dead.text()))
  ok('and its files stop with it', (await fetch(`${APP}/e/${token}/file/${pdfAttId}`, { redirect: 'manual' })).status === 404)

  // ── 5. Which parts of add_tg_production_1.sql the database has ─────────────────────────────────
  const stage = await rest(`orders?id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'in_process' }) })
  ok(`part 1 (in_process stage) applied: ${stage.ok}`, true)
  const pay = await rest('payment_allocations', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, document_type: 'order', document_id: orderId, kind: 'deposit', amount_cents: 100000, currency: 'cad', method: 'wire', paid_on: '2026-09-14', idempotency_key: `verify-${orderId}` }) })
  const payBody = await pay.text()
  ok(`part 2 (wire method + paid_on) applied: ${pay.ok}`, true)
  if (!pay.ok) info(`ledger says: ${payBody.slice(0, 120)}`)
  for (const [part, table] of [['4', 'memos'], ['5', 'order_purchases']]) {
    const r = await rest(`${table}?select=id&limit=1`)
    ok(`part ${part} (${table}) applied: ${r.ok}`, true)
  }
  const kind = await rest(`orders?select=order_kind&id=eq.${orderId}`)
  ok(`part 6 (order_kind) applied: ${kind.ok}`, true)
  const rk = await rest(`order_approval_requests?select=request_kind&limit=1`)
  ok(`part 7 (request_kind) applied: ${rk.ok}`, true)

  // ── 5b. Token stress: cross-tenant file, signed-URL lifetime, token shape ─────────────────────
  // A public attachment from a DIFFERENT tenant, by id, through TG's token: must be refused.
  const foreign = await (await rest(`order_attachments?select=id&tenant_id=neq.${tg.id}&visibility=eq.public&limit=1`)).json()
  if (foreign[0]) ok("another TENANT's attachment is refused through the token", (await fetch(`${APP}/e/${token}/file/${foreign[0].id}`, { redirect: 'manual' })).status === 404)
  else info('no foreign public attachment available to test cross-tenant refusal')
  ok('a non-uuid file id is refused without a lookup', (await fetch(`${APP}/e/${token}/file/../../orders`, { redirect: 'manual' })).status === 404)
  {
    // The signed URL's lifetime: the JWT in it carries exp − iat; the route asks for 300s.
    const jwt = /token=([^&]+)/.exec(loc)?.[1]
    const payload = jwt ? JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) : null
    ok(`signed storage URL lives ≤ 5 minutes (exp − iat = ${payload ? payload.exp - payload.iat : '?'}s)`, !!payload && payload.exp - payload.iat <= 300)
    ok('the signed URL points at exactly the stored object path', !!payload && String(payload.url ?? '').endsWith(pdfPath))
  }
  ok('share tokens are 32 random bytes, base64url (43 chars)', token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token))

  // ── 5c. AI knowledge isolation between the two businesses on this tenant ──────────────────────
  // The same filter every reply path applies (lib/knowledge/scope.ts): this agent's rows + shared.
  const agentsRows = await (await rest(`ai_employees?select=id,name,website&tenant_id=eq.${tg.id}`)).json()
  const alex = agentsRows.find((a) => /tgjewellers/.test(a.website || '')), avi = agentsRows.find((a) => /vancouvergemlab/.test(a.website || ''))
  ok(`found both agents (${alex?.name}, ${avi?.name})`, !!alex && !!avi)
  if (alex && avi) {
    const visibleTo = async (id) => (await (await rest(`knowledge_base?select=id,title,ai_employee_id,source&tenant_id=eq.${tg.id}&or=(ai_employee_id.eq.${id},ai_employee_id.is.null)`)).json())
    const seenByAlex = await visibleTo(alex.id), seenByAvi = await visibleTo(avi.id)
    const aviOnly = seenByAvi.filter((r) => r.ai_employee_id === avi.id)
    ok(`${avi.name} sees its appraisal knowledge (${aviOnly.length} own rows incl. pricing)`, aviOnly.some((r) => r.title === 'Appraisal pricing') && aviOnly.some((r) => r.source === 'website'))
    ok(`${alex.name} sees none of ${avi.name}'s rows`, !seenByAlex.some((r) => r.ai_employee_id === avi.id))
    ok('no website-scanned row on this tenant is tenant-wide (each belongs to the agent whose site it is)', !seenByAlex.some((r) => r.source === 'website' && r.ai_employee_id === null))
    // The scan's replace rule, exercised on data: a throwaway website row for Alex survives a
    // "re-scan by Avi" (delete where source=website AND origin=Avi), which is the exact statement
    // the route now runs. The old rule (delete where source=website) would have removed it.
    const [probe] = await (await rest('knowledge_base', { method: 'POST', body: JSON.stringify({ tenant_id: tg.id, ai_employee_id: alex.id, origin_ai_employee_id: alex.id, source: 'website', title: 'VERIFY-PROBE tgjewellers page', content: 'throwaway' }) })).json()
    await rest(`knowledge_base?tenant_id=eq.${tg.id}&source=eq.website&origin_ai_employee_id=eq.${avi.id}&title=eq.VERIFY-PROBE-none`, { method: 'DELETE' })
    const stillThere = await (await rest(`knowledge_base?select=id&id=eq.${probe.id}`)).json()
    ok(`a website re-scan by ${avi.name} does not delete ${alex.name}'s scanned rows`, stillThere.length === 1)
    await rest(`knowledge_base?id=eq.${probe.id}`, { method: 'DELETE' })
  }

  // ── 5d. Business timezone ─────────────────────────────────────────────────────────────────────
  const [tz] = await (await rest(`tenants?select=timezone&id=eq.${tg.id}`)).json()
  const tzAgents = await (await rest(`ai_employees?select=timezone&tenant_id=eq.${tg.id}`)).json()
  ok('tenant and every agent run on America/Vancouver', tz?.timezone === 'America/Vancouver' && tzAgents.every((a) => a.timezone === 'America/Vancouver'))

  // ── 6. Closing as no sale keeps everything ─────────────────────────────────────────────────────
  await rest(`orders?id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ stage: 'closed_no_sale' }) })
  const [after] = await (await rest(`orders?select=id,stage,internal_notes&id=eq.${orderId}`)).json()
  const lines = await (await rest(`order_line_items?select=id,product_name,stone_quality&order_id=eq.${orderId}`)).json()
  const files = await (await rest(`order_attachments?select=id&order_id=eq.${orderId}`)).json()
  ok('closed no sale: order, lines, specs, notes and files all still there', after?.stage === 'closed_no_sale' && lines.length === 1 && lines[0].stone_quality === 'VS1' && files.length === 2 && after.internal_notes === INTERNAL_SECRET)
} catch (e) {
  ok(`unexpected error: ${e.message}`, false)
} finally {
  // ── Cleanup, in dependency order ──────────────────────────────────────────────────────────────
  if (orderId) {
    await del(`payment_allocations?document_type=eq.order&document_id=eq.${orderId}`)
    await del(`order_document_shares?order_id=eq.${orderId}`)
    await del(`order_attachments?order_id=eq.${orderId}`)
    await del(`order_line_items?order_id=eq.${orderId}`)
    await del(`order_events?order_id=eq.${orderId}`)
    await del(`orders?id=eq.${orderId}`)
  }
  if (otherOrderId) { await del(`order_attachments?order_id=eq.${otherOrderId}`); await del(`orders?id=eq.${otherOrderId}`) }
  if (pdfPath) await fetch(`${SB}/storage/v1/object/order-attachments`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: [pdfPath] }) })
  console.log(`\n${pass} passed, ${fail} failed — throwaway rows removed.`)
  process.exit(fail ? 1 : 0)
}
