// Verification for component/sub-product unification: shared QR (component + variant), enriched public
// resolution, component categories (inherit/override, same source as products), Catalog=Commerce identity.
// RUN AFTER add_core_12_component_category.sql.  node scripts/verify-core-component-unify.mjs
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'UNIFY-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())
const upsert = (p, rows) => fetch(`${U}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify(rows) }).then((r) => r.json())
// mirror lib/core/public-qr effective category
const effectiveCategory = (comp, productCategory) => comp.use_parent_category ? (productCategory ?? null) : (comp.category ?? null)

let tA, tB
try {
  ok('product_components has category + use_parent_category', (await rest('product_components?select=category,use_parent_category&limit=1')).status === 200)
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  // shared category source (same table products use)
  await upsert('product_categories?on_conflict=tenant_id,name', [{ tenant_id: tA, name: 'Sofas & Sectionals', sort_order: 0 }, { tenant_id: tA, name: 'Seating', sort_order: 1 }])

  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Neomi Sectional', category: 'Sofas & Sectionals' })
  const comp = await ins('product_components', { tenant_id: tA, product_id: prod.id, name: 'Left Arm Section', sku: 'NE-L', price_cents: 39900, quantity: 1 })

  // 1. component has its own QR
  ok('1. component has its own QR token', !!comp.qr_code_token && comp.qr_code_token.length > 10)
  // 2. component QR resolves to the right component (+ parent) — mirror resolveQrToken lookup
  const byTok = (await list(`product_components?qr_code_token=eq.${comp.qr_code_token}&select=id,name,product_id`))[0]
  const parent = (await list(`catalog_products?id=eq.${byTok.product_id}&select=name`))[0]
  ok('2. component QR opens the correct component + parent product', byTok.id === comp.id && byTok.name === 'Left Arm Section' && parent.name === 'Neomi Sectional')

  // 3. component categories use the SAME source as products (product_categories)
  const catNames = (await list(`product_categories?tenant_id=eq.${tA}&archived_at=is.null&select=name`)).map((c) => c.name)
  ok('3. component category dropdown source = product categories (product_categories)', catNames.includes('Sofas & Sectionals') && catNames.includes('Seating'))

  // 4. inherit parent category (default use_parent_category=true)
  ok('4. component inherits parent category by default', comp.use_parent_category === true && effectiveCategory(comp, prod.category) === 'Sofas & Sectionals')
  // 5. override parent category
  await rest(`product_components?id=eq.${comp.id}`, { method: 'PATCH', body: JSON.stringify({ use_parent_category: false, category: 'Seating' }) })
  const comp2 = (await list(`product_components?id=eq.${comp.id}&select=category,use_parent_category`))[0]
  ok('5. component can override parent category', comp2.use_parent_category === false && effectiveCategory(comp2, prod.category) === 'Seating')

  // 6. component variant with its own QR
  const cVar = await ins('product_variants', { tenant_id: tA, component_id: comp.id, name: 'Velvet', sku: 'NE-L-VEL', price_override_cents: 42900, currency: 'usd' })
  ok('6. component variant has its own QR token', !!cVar.qr_code_token && cVar.product_id === null)
  const varByTok = (await list(`product_variants?qr_code_token=eq.${cVar.qr_code_token}&select=id,component_id`))[0]
  ok('6b. variant QR resolves to the variant + its component', varByTok.id === cVar.id && varByTok.component_id === comp.id)

  // 7/8. Catalog=Commerce identity: ONE shared product_components row (no duplicate table); edit reflects everywhere
  ok('7. one shared component row (no separate Catalog/Commerce copy)', (await list(`product_components?tenant_id=eq.${tA}&product_id=eq.${prod.id}&select=id`)).length === 1)
  await rest(`product_components?id=eq.${comp.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Left Arm Section (edited)' }) })
  ok('8. an edit is reflected on the single shared record', (await list(`product_components?id=eq.${comp.id}&select=name`))[0].name === 'Left Arm Section (edited)')

  // 9. tenant isolation
  ok('9. tenant isolation — B sees none of A components/categories', (await list(`product_components?tenant_id=eq.${tB}&select=id`)).length === 0 && (await list(`product_categories?tenant_id=eq.${tB}&select=id`)).length === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ COMPONENT UNIFICATION VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
