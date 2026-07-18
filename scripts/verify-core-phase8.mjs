// Integration verification for Scalix Core Phase 8A (vertical schema packages). RUN AFTER applying
// add_core_8_schema_packages.sql.  node scripts/verify-core-phase8.mjs
// Proves: package catalog seeded; installing a package materializes a tenant's field_definitions (+options)
// tagged with source_package_id; a Jewelry tenant receives ZERO furniture fields; installs are idempotent
// (no duplicate defs); reinstall/upgrade preserves tenant field_values; package fields are distinguishable
// from tenant-authored custom fields. Mirrors lib/core/packages.installPackage over REST. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const UP = { ...H, Prefer: 'return=representation,resolution=merge-duplicates' }
const TAG = 'COREP8-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const upsert = async (p, rows) => (await (await fetch(`${U}/rest/v1/${p}`, { method: 'POST', headers: UP, body: JSON.stringify(rows) })).json())

// Faithful REST mirror of lib/core/packages.installPackage (same upsert conflict targets).
async function install(tenantId, pkgKey) {
  const pkg = (await list(`vertical_schema_packages?key=eq.${pkgKey}&select=id,version`))[0]
  const fields = await list(`vertical_schema_package_fields?package_id=eq.${pkg.id}&select=*&order=sort_order`)
  const defRows = fields.map((f) => ({ tenant_id: tenantId, entity_type: f.entity_type, key: f.key, label: f.label, field_type: f.field_type, required: f.required, validation: f.validation, default_value: f.default_value, sort_order: f.sort_order, source_package_id: pkg.id, active: true }))
  const upserted = await upsert('field_definitions?on_conflict=tenant_id,entity_type,key', defRows)
  const idByKey = new Map(upserted.map((d) => [`${d.entity_type}:${d.key}`, d.id]))
  const optRows = []
  for (const f of fields) { const opts = Array.isArray(f.options) ? f.options : []; const id = idByKey.get(`${f.entity_type}:${f.key}`); opts.forEach((o, i) => optRows.push({ tenant_id: tenantId, field_definition_id: id, value: o.value, label: o.label, sort_order: i, active: true })) }
  if (optRows.length) await upsert('field_options?on_conflict=field_definition_id,value', optRows)
  await upsert('tenant_schema_installations?on_conflict=tenant_id,package_id', [{ tenant_id: tenantId, package_id: pkg.id, installed_version: pkg.version, status: 'installed' }])
  return { pkgId: pkg.id, fields: fields.length }
}

let tFurn, tJewel
try {
  tFurn = (await ins('tenants', { business_name: `${TAG}-furniture` })).id
  tJewel = (await ins('tenants', { business_name: `${TAG}-jewelry` })).id

  for (const t of ['vertical_schema_packages', 'vertical_schema_package_fields', 'tenant_schema_installations']) {
    ok(`table ${t} exists`, (await rest(`${t}?select=id&limit=1`)).status === 200)
  }
  ok('field_definitions has source_package_id column', (await rest('field_definitions?select=source_package_id&limit=1')).status === 200)

  // catalog seeded
  const furnPkg = (await list('vertical_schema_packages?key=eq.furniture&select=id,version,status'))[0]
  const jewelPkg = (await list('vertical_schema_packages?key=eq.jewelry&select=id,version,status'))[0]
  ok('furniture package seeded + published', furnPkg?.status === 'published')
  ok('jewelry package seeded + published', jewelPkg?.status === 'published')
  ok('furniture package has field templates', (await list(`vertical_schema_package_fields?package_id=eq.${furnPkg.id}&select=key`)).map((f) => f.key).includes('fabric'))

  // install furniture for A, jewelry for B
  const fi = await install(tFurn, 'furniture')
  await install(tJewel, 'jewelry')

  const aKeys = (await list(`field_definitions?tenant_id=eq.${tFurn}&entity_type=eq.product&select=key,source_package_id`))
  const bKeys = (await list(`field_definitions?tenant_id=eq.${tJewel}&entity_type=eq.product&select=key,source_package_id`))
  const aK = aKeys.map((d) => d.key), bK = bKeys.map((d) => d.key)
  ok('furniture tenant got fabric + all dimension fields', ['fabric', 'width_cm', 'height_cm', 'depth_cm'].every((k) => aK.includes(k)))
  ok('installed defs are tagged with source_package_id', aKeys.filter((d) => ['fabric', 'width_cm'].includes(d.key)).every((d) => d.source_package_id === fi.pkgId))
  const fabricDefId = (await list(`field_definitions?tenant_id=eq.${tFurn}&entity_type=eq.product&key=eq.fabric&select=id`))[0]?.id
  ok('fabric options materialized (velvet…)', (await list(`field_options?field_definition_id=eq.${fabricDefId}&select=value`)).map((o) => o.value).includes('velvet'))
  ok('jewelry tenant got carat + metal', ['carat', 'metal'].every((k) => bK.includes(k)))

  // TENANT SEPARATION — the non-negotiable guarantee
  ok('furniture tenant has NO jewelry fields (carat/metal)', !aK.includes('carat') && !aK.includes('metal'))
  ok('jewelry tenant has NO furniture fields (fabric/width_cm/height_cm/depth_cm)', !['fabric', 'width_cm', 'height_cm', 'depth_cm'].some((k) => bK.includes(k)))

  // set a tenant value, then reinstall — value must survive (idempotent, non-destructive)
  const prod = await ins('catalog_products', { tenant_id: tFurn, name: `${TAG} Sofa` })
  const fabricDef = (await list(`field_definitions?tenant_id=eq.${tFurn}&entity_type=eq.product&key=eq.fabric&select=id`))[0]
  await ins('field_values', { tenant_id: tFurn, field_definition_id: fabricDef.id, record_type: 'product', record_id: prod.id, value: JSON.stringify('velvet') })
  await install(tFurn, 'furniture') // reinstall
  const defsAfter = await list(`field_definitions?tenant_id=eq.${tFurn}&entity_type=eq.product&source_package_id=eq.${fi.pkgId}&select=id`)
  ok('reinstall does NOT duplicate definitions (idempotent)', defsAfter.length === 4)
  const valsAfter = await list(`field_values?tenant_id=eq.${tFurn}&record_id=eq.${prod.id}&field_definition_id=eq.${fabricDef.id}&select=value`)
  ok('reinstall preserves tenant field_values', valsAfter.length === 1 && JSON.parse(valsAfter[0].value) === 'velvet')

  // package fields vs tenant-authored custom field are distinguishable
  await ins('field_definitions', { tenant_id: tFurn, entity_type: 'product', key: 'internal_ref', label: 'Internal Ref', field_type: 'text' })
  const custom = (await list(`field_definitions?tenant_id=eq.${tFurn}&key=eq.internal_ref&select=source_package_id`))[0]
  ok('tenant-authored custom field has NULL source_package_id', custom.source_package_id === null)

  // install record present + single (unique tenant,package)
  const installs = await list(`tenant_schema_installations?tenant_id=eq.${tFurn}&select=installed_version,status,package_id`)
  ok('single install record for furniture, version 1, installed', installs.filter((i) => i.package_id === fi.pkgId).length === 1 && installs.find((i) => i.package_id === fi.pkgId)?.installed_version === 1)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  for (const t of [tFurn, tJewel]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 8A VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
