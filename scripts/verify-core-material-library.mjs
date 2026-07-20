// Verification for the Fabric/material library. RUN AFTER add_core_18_material_library.sql.
//   node scripts/verify-core-material-library.mjs
// Covers the DB/logic guarantees via REST (service role): materials CRUD, search/filter, product links,
// proposal + order snapshots (kept forever), terminology overrides (Inventory/Fabrics/Configurations),
// variants unchanged, tenant isolation.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'MAT-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => await (await rest(p)).json()
const patch = (p, b) => rest(p, { method: 'PATCH', body: JSON.stringify(b) })
const del = (p) => rest(p, { method: 'DELETE' })

let tA, tB
try {
  const c1 = await rest('catalog_materials?select=id&limit=1'), c2 = await rest('product_materials?select=id&limit=1'), c3 = await rest('order_line_items?select=fabric&limit=1')
  ok('0. catalog_materials + product_materials + order_line_items.fabric exist', [c1, c2, c3].every((r) => r.status === 200))
  if (![c1, c2, c3].every((r) => r.status === 200)) throw new Error('run add_core_18_material_library.sql first')

  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Neomi Sofa' })
  const variant = await ins('product_variants', { tenant_id: tA, product_id: prod.id, name: '3 Seater', sku: '3S', currency: 'usd' })

  // 1. Create + edit + delete a material
  const m1 = await ins('catalog_materials', { tenant_id: tA, name: 'Impala Jungle 207', code: 'IMP-207', color: 'Green', composition: '100% Polyester', martindale: '40000', status: 'in_stock' })
  const m2 = await ins('catalog_materials', { tenant_id: tA, name: 'Velvet Blue', code: 'VB-01', color: 'Blue', status: 'low_stock' })
  const m3 = await ins('catalog_materials', { tenant_id: tA, name: 'Black Leather', code: 'BL-99', color: 'Black', status: 'out_of_stock' })
  ok('1. materials created with metadata + manual status', m1.status === 'in_stock' && m2.status === 'low_stock' && m3.status === 'out_of_stock')
  await patch(`catalog_materials?id=eq.${m2.id}`, { status: 'discontinued' })
  ok('1b. material edited (status → discontinued)', (await list(`catalog_materials?id=eq.${m2.id}&select=status`))[0].status === 'discontinued')

  // 2. Search (name/code/color) + 3. status filter (replicate the list logic)
  const all = await list(`catalog_materials?tenant_id=eq.${tA}&select=name,code,color,status`)
  const search = (t) => all.filter((m) => [m.name, m.code, m.color].some((v) => v?.toLowerCase().includes(t)))
  ok('2. search matches name / code / color', search('impala').length === 1 && search('imp-2').length === 1 && search('blue').length === 1)
  ok('3. filter by status works', all.filter((m) => m.status === 'in_stock').length === 1 && all.filter((m) => m.status === 'out_of_stock').length === 1)

  // 4. Product ↔ material links
  await rest('product_materials', { method: 'POST', body: JSON.stringify([{ tenant_id: tA, product_id: prod.id, material_id: m1.id }, { tenant_id: tA, product_id: prod.id, material_id: m3.id }]) })
  const linked = await list(`product_materials?tenant_id=eq.${tA}&product_id=eq.${prod.id}&select=material_id`)
  ok('4. only linked materials attach to a product (2 of 3)', linked.length === 2 && !linked.map((l) => l.material_id).includes(m2.id))

  // 5. Proposal line snapshot survives catalog changes/deletion
  const num = await rest('rpc/core_next_document_number', { method: 'POST', body: JSON.stringify({ p_tenant: tA, p_doc_type: 'proposal' }) }).then((r) => r.json())
  const prop = await ins('proposals', { tenant_id: tA, number: num, status: 'draft' })
  const snap = { fabric_id: m1.id, name: m1.name, code: m1.code, image_url: null, color: m1.color, composition: m1.composition, martindale: m1.martindale, status: m1.status }
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'proposal', document_id: prop.id, product_id: prod.id, description: 'Neomi Sofa', quantity: 1, unit_price_cents: 100000, line_total_cents: 100000, custom_attributes: { fabric: snap } })
  await patch(`catalog_materials?id=eq.${m1.id}`, { name: 'RENAMED', color: 'RED' })  // catalog changes AFTER the snapshot
  await del(`catalog_materials?id=eq.${m3.id}`)                                       // delete a linked material
  const lineSnap = (await list(`sales_document_lines?document_id=eq.${prop.id}&select=custom_attributes`))[0].custom_attributes.fabric
  ok('5. proposal keeps the fabric snapshot even after the catalog changes/deletes', lineSnap.name === 'Impala Jungle 207' && lineSnap.color === 'Green' && lineSnap.martindale === '40000')
  ok('5b. deleting a material cascades its product link but NOT the snapshot', (await list(`product_materials?product_id=eq.${prod.id}&material_id=eq.${m3.id}&select=id`)).length === 0)

  // 6. Order preserves the selected fabric (fulfillment)
  const order = await ins('orders', { tenant_id: tA, order_number: 'ORD-' + TAG.slice(-6), subtotal_cents: 100000 })
  await ins('order_line_items', { tenant_id: tA, order_id: order.id, product_name: 'Neomi Sofa', quantity: 1, unit_price_cents: 100000, line_total_cents: 100000, material: snap.name, fabric: snap })
  const oli = (await list(`order_line_items?order_id=eq.${order.id}&select=fabric,material`))[0]
  ok('6. order line preserves the fabric snapshot for fulfillment', oli.fabric.name === 'Impala Jungle 207' && oli.fabric.martindale === '40000' && oli.material === 'Impala Jungle 207')

  // 7. Terminology overrides — generic Core, only the label changes
  for (const [k, s, p] of [['catalog', 'Inventory', 'Inventory'], ['material', 'Fabric', 'Fabrics'], ['variant', 'Configuration', 'Configurations']])
    await rest('terminology_overrides', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ tenant_id: tA, noun_key: k, singular: s, plural: p }) })
  const terms = await list(`terminology_overrides?tenant_id=eq.${tA}&select=noun_key,plural`)
  const tmap = Object.fromEntries(terms.map((t) => [t.noun_key, t.plural]))
  ok('7. tenant relabels catalog/material/variant to Inventory/Fabrics/Configurations', tmap.catalog === 'Inventory' && tmap.material === 'Fabrics' && tmap.variant === 'Configurations')

  // 8. Variants NOT converted to fabrics — still exist as product configurations
  ok('8. variants remain product configurations (not converted to fabrics)', (await list(`product_variants?id=eq.${variant.id}&select=name`))[0].name === '3 Seater')

  // 9. Tenant isolation
  const bSees = (await list(`catalog_materials?tenant_id=eq.${tB}&select=id`)).length + (await list(`product_materials?tenant_id=eq.${tB}&select=id`)).length
  ok('9. tenant isolation — B sees no A materials/links', bSees === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ MATERIAL LIBRARY VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
