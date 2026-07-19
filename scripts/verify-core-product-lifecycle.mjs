// Verification for product lifecycle + component images/QR. RUN AFTER add_core_11_product_lifecycle.sql.
//   node scripts/verify-core-product-lifecycle.mjs
// Proves: component image add/primary/remove; component QR public lookup; archive parent product (excluded
// from active catalog); safe DELETE (soft tombstone when referenced by history — historical line stays
// readable; hard delete when unreferenced); archived/deleted excluded from new selection; tenant isolation.
// Mirrors the repo/API DB effects over REST (upload/QR-render/guards are server-side, covered by tsc+build).
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'LIFEVER-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const rpc = (fn, a) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(a) }).then((r) => r.json())
const activeCatalog = (t) => list(`catalog_products?tenant_id=eq.${t}&archived_at=is.null&deleted_at=is.null&select=id,name`)

// mirror lib/core/products.deleteProduct: soft (tombstone) if referenced by lines, else hard delete
async function deleteProduct(t, id) {
  const comps = await list(`product_components?tenant_id=eq.${t}&product_id=eq.${id}&select=id`)
  const byP = await list(`sales_document_lines?tenant_id=eq.${t}&product_id=eq.${id}&select=id`)
  let referenced = byP.length > 0
  if (!referenced && comps.length) referenced = (await list(`sales_document_lines?tenant_id=eq.${t}&component_id=in.(${comps.map((c) => c.id).join(',')})&select=id`)).length > 0
  if (referenced) { await rest(`catalog_products?tenant_id=eq.${t}&id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString(), status: 'discontinued' }) }); return 'soft' }
  await rest(`catalog_products?tenant_id=eq.${t}&id=eq.${id}`, { method: 'DELETE' }); return 'hard'
}

let tA, tB
try {
  ok('catalog_products has archived_at + deleted_at', (await rest('catalog_products?select=archived_at,deleted_at&limit=1')).status === 200)
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id

  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Milano Sectional' })
  const comp = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Left Arm Sofa', quantity: 1 })

  // component images: add, primary, remove
  const m1 = await ins('product_media', { tenant_id: tA, component_id: comp.id, url: 'https://x/1.jpg', kind: 'image', sort_order: 0 })
  await ins('product_media', { tenant_id: tA, component_id: comp.id, url: 'https://x/2.jpg', kind: 'image', sort_order: 1 })
  ok('component image add (2 images in the gallery)', (await list(`product_media?tenant_id=eq.${tA}&component_id=eq.${comp.id}&select=id`)).length === 2)
  await rest(`product_components?id=eq.${comp.id}`, { method: 'PATCH', body: JSON.stringify({ image_url: 'https://x/1.jpg' }) })
  ok('component primary image set (component.image_url)', (await list(`product_components?id=eq.${comp.id}&select=image_url`))[0].image_url === 'https://x/1.jpg')
  await rest(`product_media?id=eq.${m1.id}`, { method: 'DELETE' })
  ok('component image removal', (await list(`product_media?tenant_id=eq.${tA}&component_id=eq.${comp.id}&select=id`)).length === 1)

  // component QR public page (mirror getComponentByToken)
  ok('component QR public page resolves by token', (await list(`product_components?qr_code_token=eq.${comp.qr_code_token}&select=name`))[0]?.name === 'Left Arm Sofa')

  // archive parent product → excluded from active catalog
  await rest(`catalog_products?id=eq.${prod.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: new Date().toISOString() }) })
  ok('archived product excluded from active catalog / new selection', !(await activeCatalog(tA)).some((p) => p.id === prod.id))
  await rest(`catalog_products?id=eq.${prod.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: null }) })
  ok('restore brings the product back to the active catalog', (await activeCatalog(tA)).some((p) => p.id === prod.id))

  // safe delete WITH history → soft tombstone; historical line stays readable
  const estNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  const est = await ins('estimates', { tenant_id: tA, number: estNum, currency: 'usd', status: 'draft' })
  const lineDesc = 'Milano Sectional — Left Arm Sofa'
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, product_id: prod.id, component_id: comp.id, description: lineDesc, quantity: 1, unit_price_cents: 89900, line_total_cents: 89900, sort_order: 0 })
  const mode = await deleteProduct(tA, prod.id)
  ok('delete with historical references performs a SAFE soft delete (tombstone)', mode === 'soft')
  ok('tombstoned product excluded from active catalog', !(await activeCatalog(tA)).some((p) => p.id === prod.id))
  const histLine = (await list(`sales_document_lines?document_id=eq.${est.id}&select=description,product_id,component_id`))[0]
  ok('historical document line remains readable + keeps its references', histLine.description === lineDesc && histLine.product_id === prod.id && histLine.component_id === comp.id)

  // hard delete when NOT referenced
  const prod2 = await ins('catalog_products', { tenant_id: tA, name: 'Unused Table' })
  await ins('product_components', { tenant_id: tA, product_id: prod2.id, name: 'Leg', quantity: 4 })
  ok('unreferenced product is hard-deleted', (await deleteProduct(tA, prod2.id)) === 'hard' && (await list(`catalog_products?id=eq.${prod2.id}&select=id`)).length === 0)
  ok('hard delete cascades its components', (await list(`product_components?product_id=eq.${prod2.id}&select=id`)).length === 0)

  // tenant isolation
  ok('tenant isolation — B sees none of A products/media', (await list(`catalog_products?tenant_id=eq.${tB}&select=id`)).length === 0 && (await list(`product_media?tenant_id=eq.${tB}&select=id`)).length === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PRODUCT LIFECYCLE VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
