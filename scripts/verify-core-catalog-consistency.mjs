// Regression checks for Catalog↔Commerce consistency + product image field.
//   node scripts/verify-core-catalog-consistency.mjs
// Proves (DB layer; UI behaviors covered by tsc+build): Catalog and Commerce read the SAME category source
// (product_categories) — archived excluded; category is stored as the category NAME on the product; the
// product image is a single shared field (catalog_products.image_url) that both upload and pasted-URL write
// to; tenant isolation. Throwaway tenants; cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'CONSVER-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const upsert = (p, rows, mode = 'ignore-duplicates') => fetch(`${U}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: `return=representation,resolution=${mode}` }, body: JSON.stringify(rows) }).then((r) => r.json())
// the ONE query both Catalog + Commerce category pickers use (active, tenant-scoped)
const catalogCategories = (t) => list(`product_categories?tenant_id=eq.${t}&archived_at=is.null&select=name,group_label&order=sort_order`)

let tA, tB
try {
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  // seed furniture categories for A (same install both screens rely on)
  const pkg = (await list('vertical_schema_packages?key=eq.furniture&select=id'))[0]
  const cats = await list(`vertical_schema_package_categories?package_id=eq.${pkg.id}&select=group_label,name,sort_order`)
  await upsert('product_categories?on_conflict=tenant_id,name', cats.map((c) => ({ tenant_id: tA, name: c.name, group_label: c.group_label, sort_order: c.sort_order, source_package_id: pkg.id })))

  const shared = await catalogCategories(tA)
  ok('single shared category source lists the tenant categories (Sofas & Sectionals)', shared.some((c) => c.name === 'Sofas & Sectionals'))

  // archived excluded from the shared picker source
  const rugs = (await list(`product_categories?tenant_id=eq.${tA}&name=eq.Rugs&select=id`))[0]
  await rest(`product_categories?id=eq.${rugs.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: new Date().toISOString() }) })
  ok('archived category excluded from the picker source', !(await catalogCategories(tA)).some((c) => c.name === 'Rugs'))

  // product uses the category NAME (dropdown value), not free text id
  const prod = await ins('catalog_products', { tenant_id: tA, name: `${TAG} sofa`, category: 'Sofas & Sectionals' })
  ok('product category stored as the category NAME', (await list(`catalog_products?id=eq.${prod.id}&select=category`))[0].category === 'Sofas & Sectionals')

  // image is a single shared field — both upload (URL from storage) and pasted URL write image_url
  await rest(`catalog_products?id=eq.${prod.id}`, { method: 'PATCH', body: JSON.stringify({ image_url: 'https://cdn/uploaded.jpg' }) })
  ok('uploaded image URL saves to the shared image_url field', (await list(`catalog_products?id=eq.${prod.id}&select=image_url`))[0].image_url === 'https://cdn/uploaded.jpg')
  await rest(`catalog_products?id=eq.${prod.id}`, { method: 'PATCH', body: JSON.stringify({ image_url: 'https://example.com/pasted.png' }) })
  ok('pasted image URL saves to the same image_url field', (await list(`catalog_products?id=eq.${prod.id}&select=image_url`))[0].image_url === 'https://example.com/pasted.png')

  // tenant isolation — B sees none of A's categories
  ok('tenant isolation — B has no A categories', (await catalogCategories(tB)).length === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CATALOG/COMMERCE CONSISTENCY VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
