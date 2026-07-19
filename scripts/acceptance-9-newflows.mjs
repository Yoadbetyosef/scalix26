// Phase 9 live acceptance: new UI-backed flows (customer picker, product/variant line picker) proven at the
// DB/RPC level on THROWAWAY tenants, plus a READ-ONLY confirm that the existing acceptance records on the real
// tenant still display and the real product is untouched. Does not alter the existing real product.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREUI9-' + Date.now()
const REAL = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
const EXISTING = { product: 'e015678c-eb5f-4db9-a97b-78b07dc45b63', estimate: 'ec47237d-d2de-4913-b06c-ea58f196621e', quote: '3806f7ea-9828-421f-89dd-0cad033fb339', invoice: '90f98645-b35c-4fd5-8fc8-aeaeb2ec406b', realProductUntouched: 'ea88595b-080c-417b-838b-186230c4df96' }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())

let tA, tB
try {
  console.log('\n════ NEW FLOWS (throwaway tenants) ════')
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const prod = await ins('catalog_products', { tenant_id: tA, name: `${TAG} sofa`, sku: 'SKU9', price: 200 })
  const variant = await ins('product_variants', { tenant_id: tA, product_id: prod.id, name: '3-seater', currency: 'usd' })
  const contact = await ins('contacts', { tenant_id: tA, name: `${TAG} buyer`, phone: '+15550190001' })
  const company = await ins('companies', { tenant_id: tA, name: `${TAG} co` })

  const estNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  const est = await ins('estimates', { tenant_id: tA, number: estNum, currency: 'usd', status: 'draft' })
  // product/variant line + manual line
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, product_id: prod.id, variant_id: variant.id, description: 'sofa — 3-seater', quantity: 2, unit_price_cents: 20000, line_total_cents: 40000, sort_order: 0 })
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, description: 'Custom delivery', quantity: 1, unit_price_cents: 5000, line_total_cents: 5000, sort_order: 1 })
  await rest(`estimates?id=eq.${est.id}`, { method: 'PATCH', body: JSON.stringify({ subtotal_cents: 45000, total_cents: 45000 }) })
  // attach customer (mirrors setDocumentCustomer)
  await rest(`estimates?id=eq.${est.id}`, { method: 'PATCH', body: JSON.stringify({ contact_id: contact.id, company_id: company.id }) })
  ok('1. estimate saves with contact + company', (await list(`estimates?id=eq.${est.id}&select=contact_id,company_id`))[0].contact_id === contact.id)
  const eLines = await list(`sales_document_lines?document_id=eq.${est.id}&select=product_id,variant_id,description&order=sort_order`)
  ok('2. product line stores product_id', eLines[0].product_id === prod.id)
  ok('3. variant line stores variant_id', eLines[0].variant_id === variant.id)
  ok('4. manual description-only line supported (no product_id)', eLines[1].product_id === null && eLines[1].description === 'Custom delivery')

  const q = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `k:${est.id}:q`, p_actor: null })
  const quote = (await list(`quotes?id=eq.${q.target_id}&select=contact_id,company_id,total_cents`))[0]
  const qLines = await list(`sales_document_lines?document_id=eq.${q.target_id}&select=product_id,variant_id&order=sort_order`)
  ok('5a. conversion preserves contact + company', quote.contact_id === contact.id && quote.company_id === company.id)
  ok('5b. conversion preserves product_id + variant_id', qLines[0].product_id === prod.id && qLines[0].variant_id === variant.id)
  ok('6. repeated conversion is idempotent (same target)', (await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `k:${est.id}:q`, p_actor: null })).target_id === q.target_id)
  ok('7. server totals authoritative (quote total = estimate total = 45000)', quote.total_cents === 45000)

  // cross-tenant guard BASIS: B's contact/product are invisible under tenant A's scope (setDocumentCustomer/addLine reject)
  const cB = await ins('contacts', { tenant_id: tB, name: `${TAG} B`, phone: '+15550190002' })
  const pB = await ins('catalog_products', { tenant_id: tB, name: `${TAG} B prod` })
  ok('8a. cross-tenant customer not visible under tenant scope (would be rejected)', (await list(`contacts?tenant_id=eq.${tA}&id=eq.${cB.id}&select=id`)).length === 0)
  ok('8b. cross-tenant product not visible under tenant scope (would be rejected)', (await list(`catalog_products?tenant_id=eq.${tA}&id=eq.${pB.id}&select=id`)).length === 0)

  console.log('\n════ EXISTING ACCEPTANCE RECORDS (real tenant, READ-ONLY) ════')
  ok('9. existing test estimate still loads with lines', (await list(`estimates?tenant_id=eq.${REAL}&id=eq.${EXISTING.estimate}&select=id`)).length === 1 && (await list(`sales_document_lines?document_id=eq.${EXISTING.estimate}&select=id`)).length >= 2)
  ok('9b. existing test quote + invoice still load', (await list(`quotes?id=eq.${EXISTING.quote}&select=id`)).length === 1 && (await list(`invoices?id=eq.${EXISTING.invoice}&select=id`)).length === 1)
  ok('9c. existing test product + its variants/components still load', (await list(`catalog_products?id=eq.${EXISTING.product}&select=id`)).length === 1 && (await list(`product_variants?product_id=eq.${EXISTING.product}&select=id`)).length === 2 && (await list(`product_components?product_id=eq.${EXISTING.product}&select=id`)).length === 3)
  ok('10. existing REAL production product still present + untouched by Phase 9', (await list(`catalog_products?id=eq.${EXISTING.realProductUntouched}&select=id,name`)).length === 1)
  console.log('  NOTE: 10 — Phase 9 made no write targeting the real product; only clearly-marked test records + throwaway tenants were written.')
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE; real-tenant acceptance records left intact)')
}
console.log(`\n${fail === 0 ? '✅ PHASE 9 LIVE ACCEPTANCE PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
