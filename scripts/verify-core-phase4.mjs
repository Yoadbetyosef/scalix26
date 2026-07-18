// Integration verification for Scalix Core Phase 4 (sales lifecycle). RUN AFTER applying
// add_core_4_sales_lifecycle.sql.  node scripts/verify-core-phase4.mjs
// Proves: sequential+unique numbering; conversion copies header+lines to a NEW numbered doc; is idempotent;
// documents stay INDEPENDENT (editing source doesn't touch target); cross-tenant convert rejected. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP4-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())
const list = async (p) => (await (await rest(p)).json())

let tA, tB
try {
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  for (const t of ['numbering_counters', 'estimates', 'quotes', 'invoices', 'sales_document_lines', 'document_status_history']) {
    ok(`table ${t} exists`, (await rest(`${t}?select=id&limit=1`)).status === 200)
  }

  // numbering: sequential + formatted
  const n1 = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  const n2 = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  ok('numbering is sequential + prefixed/padded', n1 === 'EST-0001' && n2 === 'EST-0002')

  // build an estimate with 2 lines
  const contact = await ins('contacts', { tenant_id: tA, name: 'Buyer' })
  const est = await ins('estimates', { tenant_id: tA, number: await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' }), contact_id: contact.id, currency: 'usd', subtotal_cents: 37500, total_cents: 37500 })
  const prod = await ins('catalog_products', { tenant_id: tA, name: `${TAG} item` })
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, product_id: prod.id, description: 'Sofa', quantity: 3, unit_price_cents: 12500, line_total_cents: 37500, custom_attributes: JSON.stringify({ fabric: 'velvet' }) })
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, description: 'Delivery', quantity: 1, unit_price_cents: 5000, line_total_cents: 5000 })

  // CONVERT estimate → quote
  const conv = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `${TAG}-k1`, p_actor: null })
  ok('convert returns a new quote with its own number', conv.ok === true && conv.target_type === 'quote' && /^QUO-\d{4}$/.test(conv.number))
  const qLines = await list(`sales_document_lines?tenant_id=eq.${tA}&document_type=eq.quote&document_id=eq.${conv.target_id}&order=sort_order&select=description,quantity,unit_price_cents,product_id,custom_attributes`)
  ok('all lines copied (product link + custom attrs preserved)', qLines.length === 2 && qLines[0].product_id === prod.id && qLines[0].custom_attributes.fabric === 'velvet')
  const quote = (await list(`quotes?id=eq.${conv.target_id}&select=contact_id,total_cents,source_document_type,source_document_id`))[0]
  ok('header preserved (contact, total) + provenance link set', quote.contact_id === contact.id && quote.total_cents === 37500 && quote.source_document_type === 'estimate' && quote.source_document_id === est.id)
  ok('conversion recorded status history', (await list(`document_status_history?tenant_id=eq.${tA}&document_type=eq.quote&document_id=eq.${conv.target_id}&select=id`)).length >= 1)

  // idempotent: same key → same quote, no duplicate
  const conv2 = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `${TAG}-k1`, p_actor: null })
  ok('repeat conversion is idempotent (same target, no duplicate)', conv2.ok === true && conv2.idempotent === true && conv2.target_id === conv.target_id)
  ok('exactly one quote exists from this conversion', (await list(`quotes?tenant_id=eq.${tA}&conversion_key=eq.${TAG}-k1&select=id`)).length === 1)

  // INDEPENDENCE: edit the source estimate → the quote is unchanged
  await rest(`estimates?id=eq.${est.id}`, { method: 'PATCH', body: JSON.stringify({ total_cents: 99999 }) })
  ok('editing the source does NOT mutate the converted quote', (await list(`quotes?id=eq.${conv.target_id}&select=total_cents`))[0].total_cents === 37500)

  // cross-tenant convert rejected
  const convX = await rpc('core_convert_document', { p_tenant: tB, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `${TAG}-x`, p_actor: null })
  ok('cross-tenant conversion rejected (source not in tenant)', convX.ok === false && convX.error === 'source_not_found')

  // estimate → invoice
  const inv = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'invoice', p_key: `${TAG}-inv`, p_actor: null })
  ok('estimate → invoice creates an INV-numbered invoice with lines', inv.ok === true && /^INV-\d{4}$/.test(inv.number) && (await list(`sales_document_lines?tenant_id=eq.${tA}&document_type=eq.invoice&document_id=eq.${inv.target_id}&select=id`)).length === 2)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 4 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
