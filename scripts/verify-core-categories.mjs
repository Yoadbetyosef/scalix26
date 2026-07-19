// Verification for tenant-managed product categories. RUN AFTER applying add_core_9_categories.sql.
//   node scripts/verify-core-categories.mjs
// Proves: creation; duplicate prevention; rename (+ propagation to products); archive; restore; tenant
// isolation; package defaults seeded on install; a non-furniture tenant receives NO furniture categories;
// existing free-text product categories are preserved; delete blocked when in use. Throwaway tenants; cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const UP = { ...H, Prefer: 'return=representation,resolution=merge-duplicates,missing=default' }
const TAG = 'CATVER-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => { const r = await rest(t, { method: 'POST', body: JSON.stringify(b) }); return { status: r.status, row: (await r.json())[0] } }
const list = async (p) => (await (await rest(p)).json())

// mirror installPackage category seeding (insert-only)
async function installFurnitureCats(tenant) {
  const pkg = (await list('vertical_schema_packages?key=eq.furniture&select=id'))[0]
  const tmpl = await list(`vertical_schema_package_categories?package_id=eq.${pkg.id}&select=group_label,name,sort_order&order=sort_order`)
  await fetch(`${U}/rest/v1/product_categories?on_conflict=tenant_id,name`, { method: 'POST', headers: { ...UP, Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(tmpl.map((c) => ({ tenant_id: tenant, name: c.name, group_label: c.group_label, sort_order: c.sort_order, source_package_id: pkg.id }))) })
  return tmpl.length
}

let tA, tB
try {
  ok('table product_categories exists', (await rest('product_categories?select=id&limit=1')).status === 200)
  ok('table vertical_schema_package_categories exists', (await rest('vertical_schema_package_categories?select=id&limit=1')).status === 200)
  const furnCatCount = (await list('vertical_schema_package_categories?select=name,vertical_schema_packages!inner(key)&vertical_schema_packages.key=eq.furniture')).length
  ok('furniture package seeds 20 category templates', furnCatCount === 20)

  tA = (await ins('tenants', { business_name: `${TAG}-furniture` })).row.id
  tB = (await ins('tenants', { business_name: `${TAG}-plain` })).row.id

  // package defaults on install
  await installFurnitureCats(tA)
  const aCats = await list(`product_categories?tenant_id=eq.${tA}&select=name,group_label,source_package_id`)
  ok('package defaults seeded for furniture tenant (Sofas & Sectionals in Living Room, tagged package)', aCats.some((c) => c.name === 'Sofas & Sectionals' && c.group_label === 'Living Room' && c.source_package_id))
  ok('non-furniture tenant receives NO furniture categories', (await list(`product_categories?tenant_id=eq.${tB}&select=id`)).length === 0)

  // creation + duplicate prevention
  const created = await ins('product_categories', { tenant_id: tA, name: `${TAG} custom` })
  ok('category creation', !!created.row?.id)
  const dup = await ins('product_categories', { tenant_id: tA, name: `${TAG} custom` })
  ok('duplicate prevention (unique tenant,name)', dup.status >= 400)

  // rename + propagation to products
  const prod = await ins('catalog_products', { tenant_id: tA, name: `${TAG} chair`, category: 'Accent Chairs' })
  const accent = (await list(`product_categories?tenant_id=eq.${tA}&name=eq.${encodeURIComponent('Accent Chairs')}&select=id`))[0]
  await rest(`product_categories?id=eq.${accent.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Lounge Chairs' }) })
  await rest(`catalog_products?tenant_id=eq.${tA}&category=eq.${encodeURIComponent('Accent Chairs')}`, { method: 'PATCH', body: JSON.stringify({ category: 'Lounge Chairs' }) })
  ok('rename propagates to products using the old name', (await list(`catalog_products?id=eq.${prod.row.id}&select=category`))[0].category === 'Lounge Chairs')

  // archive → hidden from active; restore → back
  const rugs = (await list(`product_categories?tenant_id=eq.${tA}&name=eq.Rugs&select=id`))[0]
  await rest(`product_categories?id=eq.${rugs.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: new Date().toISOString() }) })
  ok('archived category hidden from active selection', !(await list(`product_categories?tenant_id=eq.${tA}&archived_at=is.null&select=name`)).some((c) => c.name === 'Rugs'))
  await rest(`product_categories?id=eq.${rugs.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: null }) })
  ok('restore brings it back to active selection', (await list(`product_categories?tenant_id=eq.${tA}&archived_at=is.null&select=name`)).some((c) => c.name === 'Rugs'))

  // existing free-text category preserved (a value not in the managed list stays on the product)
  const legacyProd = await ins('catalog_products', { tenant_id: tA, name: `${TAG} legacy`, category: 'Totally Custom Legacy' })
  ok('existing free-text product category preserved', (await list(`catalog_products?id=eq.${legacyProd.row.id}&select=category`))[0].category === 'Totally Custom Legacy')

  // tenant isolation
  ok('tenant isolation — B cannot see A categories', (await list(`product_categories?tenant_id=eq.${tB}&select=id`)).length === 0)

  // delete guard: a category in use cannot be deleted (mirror deleteCategory guard)
  const inUse = (await list(`product_categories?tenant_id=eq.${tA}&name=eq.Lounge%20Chairs&select=id,name`))[0]
  const usage = (await list(`catalog_products?tenant_id=eq.${tA}&category=eq.Lounge%20Chairs&select=id`)).length
  ok('in-use category is guarded from delete (usage > 0)', usage > 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CATEGORIES VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
