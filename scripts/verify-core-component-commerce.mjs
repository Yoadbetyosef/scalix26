// Verification for component commerce (sellable components + component variants + component orders).
// RUN AFTER applying add_core_10_component_commerce.sql.  node scripts/verify-core-component-commerce.mjs
// Proves the required tests: furniture categories appear on install; a product holds multiple components;
// component has its own image + price + cost; component has dimensions + fabric (attributes); component is
// orderable independently and survives conversion; component variant has its own SKU/QR/price/inventory;
// other tenants receive no furniture defaults. Throwaway tenants; cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'CMPVER-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const rpc = (fn, a) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(a) }).then((r) => r.json())
const upsert = (p, rows, mode = 'merge-duplicates') => fetch(`${U}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: `return=representation,resolution=${mode}` }, body: JSON.stringify(rows) }).then((r) => r.json())

async function installFurniture(tenant) {
  const pkg = (await list('vertical_schema_packages?key=eq.furniture&select=id,version'))[0]
  const fields = await list(`vertical_schema_package_fields?package_id=eq.${pkg.id}&select=*`)
  const up = await upsert('field_definitions?on_conflict=tenant_id,entity_type,key', fields.map((f) => ({ tenant_id: tenant, entity_type: f.entity_type, key: f.key, label: f.label, field_type: f.field_type, required: f.required, validation: f.validation, sort_order: f.sort_order, source_package_id: pkg.id, active: true })))
  const cats = await list(`vertical_schema_package_categories?package_id=eq.${pkg.id}&select=group_label,name,sort_order`)
  await upsert('product_categories?on_conflict=tenant_id,name', cats.map((c) => ({ tenant_id: tenant, name: c.name, group_label: c.group_label, sort_order: c.sort_order, source_package_id: pkg.id })), 'ignore-duplicates')
  return up
}

let tA, tB
try {
  tA = (await ins('tenants', { business_name: `${TAG}-furn` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-plain` })).id
  await installFurniture(tA)

  // 1. furniture categories appear (in Catalog vocabulary) for the installed tenant
  ok('1. furniture categories seeded on install (Sofas & Sectionals)', (await list(`product_categories?tenant_id=eq.${tA}&name=eq.${encodeURIComponent('Sofas & Sectionals')}&select=id`)).length === 1)
  // 7. other tenants receive NO furniture defaults
  ok('7. non-furniture tenant has NO furniture categories or fields', (await list(`product_categories?tenant_id=eq.${tB}&select=id`)).length === 0 && (await list(`field_definitions?tenant_id=eq.${tB}&select=id`)).length === 0)

  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Milano Sectional', category: 'Sofas & Sectionals' })

  // 2. product can contain multiple components
  const comps = []
  for (const n of ['Left Arm Sofa', 'Right Arm Sofa', 'Corner Piece', 'Armless Chair', 'Ottoman']) comps.push(await ins('product_components', { tenant_id: tA, product_id: prod.id, name: n, quantity: 1 }))
  ok('2. product holds multiple components', (await list(`product_components?tenant_id=eq.${tA}&product_id=eq.${prod.id}&select=id`)).length === 5)

  // 3. component has its own image + price + cost
  const left = comps[0]
  await rest(`product_components?id=eq.${left.id}`, { method: 'PATCH', body: JSON.stringify({ image_url: 'https://x/left.jpg', price_cents: 89900, cost_cents: 42000, description: 'Left-facing arm sofa', component_type: 'seat', track_inventory: true }) })
  const l = (await list(`product_components?id=eq.${left.id}&select=image_url,price_cents,cost_cents,track_inventory`))[0]
  ok('3. component has its own image, price and cost', l.image_url === 'https://x/left.jpg' && Number(l.price_cents) === 89900 && Number(l.cost_cents) === 42000)

  // 4. component has dimensions + fabric (from installed component-scope field_definitions)
  const fabricDef = (await list(`field_definitions?tenant_id=eq.${tA}&entity_type=eq.component&key=eq.fabric&select=id`))[0]
  const widthDef = (await list(`field_definitions?tenant_id=eq.${tA}&entity_type=eq.component&key=eq.width_cm&select=id`))[0]
  ok('4a. furniture seeds COMPONENT-scope fabric + dimension fields', !!fabricDef && !!widthDef)
  await upsert('field_values?on_conflict=field_definition_id,record_id', [{ tenant_id: tA, field_definition_id: fabricDef.id, record_type: 'component', record_id: left.id, value: 'velvet' }, { tenant_id: tA, field_definition_id: widthDef.id, record_type: 'component', record_id: left.id, value: 95 }])
  const cv = await list(`field_values?tenant_id=eq.${tA}&record_type=eq.component&record_id=eq.${left.id}&select=field_definition_id,value`)
  ok('4b. component fabric + dimension values save + reload', cv.find((x) => x.field_definition_id === fabricDef.id)?.value === 'velvet' && Number(cv.find((x) => x.field_definition_id === widthDef.id)?.value) === 95)

  // 6. component variant with its own SKU, QR, price, cost, inventory
  const cVar = await ins('product_variants', { tenant_id: tA, component_id: left.id, name: 'Velvet / Emerald', sku: 'LEFT-VEL-EMR', price_override_cents: 94900, cost_cents: 44000, currency: 'usd' })
  ok('6a. component variant has own SKU + auto QR token + price', cVar.sku === 'LEFT-VEL-EMR' && !!cVar.qr_code_token && Number(cVar.price_override_cents) === 94900 && cVar.product_id === null)
  const loc = await ins('inventory_locations', { tenant_id: tA, name: `${TAG} wh` })
  const mv = await rpc('core_inventory_move', { p_tenant: tA, p_kind: 'variant', p_item: cVar.id, p_location: loc.id, p_movement: 'receive', p_qty: 7, p_ref_type: null, p_ref_id: null, p_key: null, p_actor: null })
  ok('6b. component variant has its own inventory (receive 7 → on_hand 7)', mv.ok && mv.on_hand === 7)

  // 5. order a component independently + conversion preserves the component link
  const estNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'estimate' })
  const est = await ins('estimates', { tenant_id: tA, number: estNum, currency: 'usd', status: 'draft', subtotal_cents: 94900, total_cents: 94900 })
  await ins('sales_document_lines', { tenant_id: tA, document_type: 'estimate', document_id: est.id, product_id: prod.id, component_id: left.id, variant_id: cVar.id, description: 'Milano — Left Arm Sofa — Velvet/Emerald', quantity: 1, unit_price_cents: 94900, line_total_cents: 94900, sort_order: 0 })
  const eLine = (await list(`sales_document_lines?document_id=eq.${est.id}&select=product_id,component_id,variant_id`))[0]
  ok('5a. a component can be ordered on its own line (parent + component + variant refs retained)', eLine.component_id === left.id && eLine.product_id === prod.id && eLine.variant_id === cVar.id)
  const conv = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'estimate', p_source_id: est.id, p_target_type: 'quote', p_key: `k:${est.id}:q`, p_actor: null })
  const qLine = (await list(`sales_document_lines?document_id=eq.${conv.target_id}&select=component_id,product_id,variant_id`))[0]
  ok('5b. conversion preserves component + product + variant references', qLine.component_id === left.id && qLine.product_id === prod.id && qLine.variant_id === cVar.id)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ COMPONENT COMMERCE VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
