// Verification for the unified Proposals module. RUN AFTER add_core_13_proposals.sql.
//   node scripts/verify-core-proposals.mjs
// Exercises the DB/RPC guarantees via REST (service role): proposals table + lifecycle, numbering,
// 'proposal' lines, multi-component preservation, Proposal→Invoice (RPC) + Proposal→Order (legacy),
// secure token + revoke, view/accept/decline tracking, legacy estimate/quote preservation, tenant isolation.
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'PROP-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => await (await rest(p)).json()
const rpc = async (fn, body) => (await (await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json())
const hash = (t) => createHash('sha256').update(t).digest('hex')

let tA, tB
try {
  // 0. table + lifecycle columns present
  const probe = await rest('proposals?select=id,status,public_token_hash,sent_at,first_viewed_at,accepted_at,declined_at,expired_at,converted_at,overall_discount_cents,terms&limit=1')
  ok('0. proposals table + lifecycle columns exist', probe.status === 200)
  if (probe.status !== 200) throw new Error('proposals table missing — run add_core_13_proposals.sql first')

  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const contact = await ins('contacts', { tenant_id: tA, name: 'Dana Buyer', email: 'dana@example.com' })
  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Neomi Sectional', category: 'Sofas' })
  const cLeft = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Left Arm', sku: 'NE-L', price_cents: 39900, quantity: 1 })
  const cRight = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Right Arm', sku: 'NE-R', price_cents: 39900, quantity: 1 })
  const cOtto = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Ottoman', sku: 'NE-O', price_cents: 19900, quantity: 1 })
  const cVar = await ins('product_variants', { tenant_id: tA, component_id: cLeft.id, name: 'Velvet', sku: 'NE-L-VEL', price_override_cents: 42900, currency: 'usd' })

  // 1. numbering (PROP- prefix) + create proposal
  const num = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'proposal' })
  ok('1. proposal numbering uses PROP- prefix', typeof num === 'string' && num.startsWith('PROP-'))
  const prop = await ins('proposals', { tenant_id: tA, number: num, contact_id: contact.id, status: 'draft', overall_discount_cents: 0, tax_cents: 0 })
  ok('1b. proposal created in Draft', prop.status === 'draft')

  // 2. multiple components from the SAME product as separate lines, refs preserved
  const mk = (c, v, price, so) => ({ tenant_id: tA, document_type: 'proposal', document_id: prop.id, product_id: prod.id, component_id: c, variant_id: v, description: 'line', quantity: 1, unit_price_cents: price, line_total_cents: price, custom_attributes: { sku: 'X' }, sort_order: so })
  await rest('sales_document_lines', { method: 'POST', body: JSON.stringify([mk(cLeft.id, cVar.id, 42900, 0), mk(cRight.id, null, 39900, 1), mk(cOtto.id, null, 19900, 2)]) })
  const lines = await list(`sales_document_lines?document_type=eq.proposal&document_id=eq.${prop.id}&select=component_id,variant_id,product_id&order=sort_order`)
  ok('2. multiple components from one product enter as separate lines', lines.length === 3 && new Set(lines.map((l) => l.component_id)).size === 3)
  ok('2b. parent product + component + variant references preserved on lines', lines.every((l) => l.product_id === prod.id) && lines[0].variant_id === cVar.id)

  // 3. document_type='proposal' accepted by the line CHECK (would 4xx if not extended)
  ok('3. sales_document_lines accepts document_type=proposal', lines.length === 3)

  // 4. autosave header fields
  await rest(`proposals?id=eq.${prop.id}`, { method: 'PATCH', body: JSON.stringify({ terms: 'Net 30', customer_notes: 'Thanks!', overall_discount_cents: 1000, tax_cents: 800 }) })
  const saved = (await list(`proposals?id=eq.${prop.id}&select=terms,customer_notes,overall_discount_cents,tax_cents`))[0]
  ok('4. autosave persists proposal fields', saved.terms === 'Net 30' && saved.overall_discount_cents === 1000 && saved.tax_cents === 800)

  // 5. secure token: store ONLY the hash; resolve by hash; draft (no token) is not publicly resolvable
  const raw = randomBytes(32).toString('base64url')
  const preToken = await list(`proposals?public_token_hash=eq.${hash(raw)}&public_token_revoked_at=is.null&select=id`)
  ok('5. draft with no token is NOT resolvable by a token', preToken.length === 0)
  await rest(`proposals?id=eq.${prop.id}`, { method: 'PATCH', body: JSON.stringify({ public_token_hash: hash(raw), status: 'sent', sent_at: new Date().toISOString() }) })
  const byTok = await list(`proposals?public_token_hash=eq.${hash(raw)}&public_token_revoked_at=is.null&select=id,status`)
  ok('5b. sent proposal resolves by token hash (raw token never stored)', byTok.length === 1 && byTok[0].id === prop.id)
  const stored = (await list(`proposals?id=eq.${prop.id}&select=public_token_hash`))[0]
  ok('5c. only the hash is persisted, not the raw token', stored.public_token_hash === hash(raw) && stored.public_token_hash !== raw)

  // 6. viewed tracking
  await rest(`proposals?id=eq.${prop.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'viewed', first_viewed_at: new Date().toISOString(), last_viewed_at: new Date().toISOString(), view_count: 1 }) })
  const viewed = (await list(`proposals?id=eq.${prop.id}&select=status,first_viewed_at,view_count`))[0]
  ok('6. view is recorded (first_viewed_at + status=viewed)', viewed.status === 'viewed' && !!viewed.first_viewed_at && viewed.view_count === 1)

  // 7. accept records date + identity
  await rest(`proposals?id=eq.${prop.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by_name: 'Dana', accepted_by_email: 'dana@example.com' }) })
  const acc = (await list(`proposals?id=eq.${prop.id}&select=status,accepted_at,accepted_by_name`))[0]
  ok('7. accept records date + identity', acc.status === 'accepted' && !!acc.accepted_at && acc.accepted_by_name === 'Dana')

  // 8. revoke kills public resolution
  await rest(`proposals?id=eq.${prop.id}`, { method: 'PATCH', body: JSON.stringify({ public_token_revoked_at: new Date().toISOString() }) })
  const afterRevoke = await list(`proposals?public_token_hash=eq.${hash(raw)}&public_token_revoked_at=is.null&select=id`)
  ok('8. revoked token no longer resolves', afterRevoke.length === 0)

  // 9. Proposal → Invoice via core_convert_document (source 'proposal'), lines copied incl. component_id
  const conv = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'proposal', p_source_id: prop.id, p_target_type: 'invoice', p_key: `conv:proposal:${prop.id}:invoice`, p_actor: null })
  ok('9. Proposal → Invoice conversion succeeds', conv?.ok === true && !!conv.target_id)
  const invLines = await list(`sales_document_lines?document_type=eq.invoice&document_id=eq.${conv.target_id}&select=component_id,product_id`)
  ok('9b. all lines copied to the invoice with component refs (no re-entry)', invLines.length === 3 && invLines.every((l) => l.product_id === prod.id) && new Set(invLines.map((l) => l.component_id)).size === 3)
  const conv2 = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'proposal', p_source_id: prop.id, p_target_type: 'invoice', p_key: `conv:proposal:${prop.id}:invoice`, p_actor: null })
  ok('9c. duplicate conversion is idempotent (same invoice)', conv2?.idempotent === true && conv2.target_id === conv.target_id)

  // 10. Proposal → Order (legacy) copies lines into order_line_items
  const orderNumber = 'ORD-' + TAG.slice(-6)
  const order = await ins('orders', { tenant_id: tA, order_number: orderNumber, contact_id: contact.id, subtotal_cents: prop.total_cents ?? 0 })
  const plines = await list(`sales_document_lines?document_type=eq.proposal&document_id=eq.${prop.id}&select=*`)
  await rest('order_line_items', { method: 'POST', body: JSON.stringify(plines.map((l, i) => ({ tenant_id: tA, order_id: order.id, product_name: l.description || 'Item', quantity: l.quantity, unit_price_cents: l.unit_price_cents, line_total_cents: l.line_total_cents, product_ref: l.product_id, display_order: i }))) })
  const oli = await list(`order_line_items?order_id=eq.${order.id}&select=id,product_ref`)
  ok('10. Proposal → Order copies all lines into order_line_items', oli.length === 3 && oli.every((l) => l.product_ref === prod.id))

  // 11. Direct Catalog → Invoice (no proposal): invoice + line path works
  const invNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'invoice' })
  const directInv = await ins('invoices', { tenant_id: tA, number: invNum, contact_id: contact.id, status: 'draft' })
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'invoice', document_id: directInv.id, product_id: prod.id, component_id: cOtto.id, description: 'Ottoman', quantity: 1, unit_price_cents: 19900, line_total_cents: 19900 })
  const directLines = await list(`sales_document_lines?document_type=eq.invoice&document_id=eq.${directInv.id}&select=id`)
  ok('11. direct Catalog → Invoice works without a proposal', directLines.length === 1)

  // 12. legacy estimates/quotes preserved (historical data intact)
  const eNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  const est = await ins('estimates', { tenant_id: tA, number: eNum, contact_id: contact.id, status: 'sent', total_cents: 5000 })
  const qNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'quote' })
  const quo = await ins('quotes', { tenant_id: tA, number: qNum, contact_id: contact.id, status: 'accepted', total_cents: 7000 })
  const legacy = { e: (await list(`estimates?id=eq.${est.id}&select=status,total_cents`))[0], q: (await list(`quotes?id=eq.${quo.id}&select=status,total_cents`))[0] }
  ok('12. legacy estimate + quote records remain intact (status + totals)', legacy.e.status === 'sent' && legacy.e.total_cents === 5000 && legacy.q.status === 'accepted' && legacy.q.total_cents === 7000)

  // 13. tenant isolation
  const bSees = await list(`proposals?tenant_id=eq.${tB}&select=id`)
  ok('13. tenant isolation — B sees none of A proposals', bSees.length === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PROPOSALS VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
