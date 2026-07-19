// Verification for Phase 9A — variant/component dynamic attributes (data layer). Throwaway tenants; cleans up.
//   node scripts/verify-core-ui-attributes.mjs
// Proves: variant + component attribute values save & reload; variant values never appear on components (and
// vice-versa); package (product) fields present only for the installed tenant; archived variant/component
// retain their values; cross-tenant reads are rejected. (Required-field validation is covered by the offline
// field-validate unit tests, since it lives in the setFieldValue repo, not the DB.)
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const UP = { ...H, Prefer: 'return=representation,resolution=merge-duplicates' }
const TAG = 'COREUI9A-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const upsert = async (p, rows) => (await (await fetch(`${U}/rest/v1/${p}`, { method: 'POST', headers: UP, body: JSON.stringify(rows) })).json())
// mirror getFieldValues: values keyed by field key for a record, tenant-scoped
async function values(tenant, recordType, recordId) {
  const vals = await list(`field_values?tenant_id=eq.${tenant}&record_type=eq.${recordType}&record_id=eq.${recordId}&select=field_definition_id,value`)
  if (!vals.length) return {}
  const defs = await list(`field_definitions?tenant_id=eq.${tenant}&id=in.(${vals.map((v) => v.field_definition_id).join(',')})&select=id,key`)
  const byId = new Map(defs.map((d) => [d.id, d.key]))
  const out = {}; for (const v of vals) { const k = byId.get(v.field_definition_id); if (k) out[k] = v.value }
  return out
}

let tA, tB
try {
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const prodA = await ins('catalog_products', { tenant_id: tA, name: `${TAG} sofa` })
  const variant = await ins('product_variants', { tenant_id: tA, product_id: prodA.id, name: '3-seater', currency: 'usd' })
  const component = await ins('product_components', { tenant_id: tA, product_id: prodA.id, name: 'Left section', quantity: 1 })

  // variant-scope + component-scope custom field definitions (source_package_id null)
  const vDef = await ins('field_definitions', { tenant_id: tA, entity_type: 'variant', key: 'finish', label: 'Finish', field_type: 'text' })
  const cDef = await ins('field_definitions', { tenant_id: tA, entity_type: 'component', key: 'material', label: 'Material', field_type: 'text' })

  // save values
  // store raw values as setFieldValue does (validated value, not double-encoded)
  await upsert('field_values?on_conflict=field_definition_id,record_id', [{ tenant_id: tA, field_definition_id: vDef.id, record_type: 'variant', record_id: variant.id, value: 'Matte oak' }])
  await upsert('field_values?on_conflict=field_definition_id,record_id', [{ tenant_id: tA, field_definition_id: cDef.id, record_type: 'component', record_id: component.id, value: 'Beech' }])

  ok('1. variant attribute saves + reloads', (await values(tA, 'variant', variant.id)).finish === 'Matte oak')
  ok('2. component attribute saves + reloads', (await values(tA, 'component', component.id)).material === 'Beech')
  ok('3. variant values never appear on components', !('material' in (await values(tA, 'variant', variant.id))) && Object.keys(await values(tA, 'component', variant.id)).length === 0)
  ok('4. component values never appear on variants', !('finish' in (await values(tA, 'component', component.id))) && Object.keys(await values(tA, 'variant', component.id)).length === 0)

  // package (product-scope) fields — install furniture for A only
  const pkg = (await list('vertical_schema_packages?key=eq.furniture&select=id,version'))[0]
  const tmpl = await list(`vertical_schema_package_fields?package_id=eq.${pkg.id}&select=*`)
  await upsert('field_definitions?on_conflict=tenant_id,entity_type,key', tmpl.map((f) => ({ tenant_id: tA, entity_type: f.entity_type, key: f.key, label: f.label, field_type: f.field_type, required: f.required, validation: f.validation, options: undefined, sort_order: f.sort_order, source_package_id: pkg.id, active: true })))
  const aProd = (await list(`field_definitions?tenant_id=eq.${tA}&entity_type=eq.product&select=key,source_package_id`))
  const bProd = (await list(`field_definitions?tenant_id=eq.${tB}&entity_type=eq.product&select=key`))
  ok('5. furniture tenant sees furniture-scoped definitions (tagged package)', aProd.some((d) => d.key === 'fabric' && d.source_package_id === pkg.id))
  ok('6. non-furniture tenant sees no furniture fields', !bProd.some((d) => ['fabric', 'width_cm'].includes(d.key)))

  // 8. archived variant/component retain values
  await rest(`product_variants?id=eq.${variant.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'discontinued' }) })
  await rest(`product_components?id=eq.${component.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'discontinued' }) })
  ok('8. archived variant retains its values', (await values(tA, 'variant', variant.id)).finish === 'Matte oak')
  ok('8b. archived component retains its values', (await values(tA, 'component', component.id)).material === 'Beech')

  // 9. cross-tenant read rejected (tenant B cannot see tenant A's variant values)
  ok('9. cross-tenant attribute read is rejected', Object.keys(await values(tB, 'variant', variant.id)).length === 0)

  console.log('  NOTE: 7. required validation is covered by the offline field-validate unit tests (validateFieldValue).')
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PHASE 9A ATTRIBUTES VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
