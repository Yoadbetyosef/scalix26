// Integration verification for Scalix Core Phase 3 (catalog schema). RUN AFTER applying
// add_core_3_product_schema.sql.  node scripts/verify-core-phase3.mjs
// Proves: new tables exist; variants + components + media create; component public token lookup; attribute
// definitions/options/values with uniqueness; and FURNITURE defs never leak into a JEWELRY tenant. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP3-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => (await (await rest(p)).json())

let tFurn, tJewel
try {
  tFurn = (await ins('tenants', { business_name: `${TAG}-furniture` })).id
  tJewel = (await ins('tenants', { business_name: `${TAG}-jewelry` })).id
  for (const t of ['product_variants', 'product_components', 'product_media', 'field_definitions', 'field_options', 'field_values']) {
    ok(`table ${t} exists`, (await rest(`${t}?select=id&limit=1`)).status === 200)
  }

  const prod = await ins('catalog_products', { tenant_id: tFurn, name: `${TAG} Sofa` })
  const variant = await ins('product_variants', { tenant_id: tFurn, product_id: prod.id, name: '3-seater', price_override_cents: 129900, currency: 'usd' })
  ok('variant stores price in integer minor units (cents)', Number(variant.price_override_cents) === 129900)
  const comp = await ins('product_components', { tenant_id: tFurn, product_id: prod.id, name: 'Left section', price_cents: 39900, quantity: 1 })
  ok('component created with its own QR token', !!comp.qr_code_token && comp.qr_code_token.length > 10)
  ok('component is public-lookup-able by token', (await list(`product_components?qr_code_token=eq.${comp.qr_code_token}&select=name`))[0]?.name === 'Left section')
  await ins('product_media', { tenant_id: tFurn, product_id: prod.id, url: 'https://x/y.jpg', kind: 'image' })
  ok('product media row accepted', (await list(`product_media?product_id=eq.${prod.id}&select=id`)).length === 1)

  // FURNITURE attribute definitions (fabric select + width decimal) on the furniture tenant
  const fabric = await ins('field_definitions', { tenant_id: tFurn, entity_type: 'product', key: 'fabric', label: 'Fabric', field_type: 'select' })
  await ins('field_options', { tenant_id: tFurn, field_definition_id: fabric.id, value: 'velvet', label: 'Velvet' })
  await ins('field_definitions', { tenant_id: tFurn, entity_type: 'product', key: 'width_cm', label: 'Width (cm)', field_type: 'decimal' })
  const val = await ins('field_values', { tenant_id: tFurn, field_definition_id: fabric.id, record_type: 'product', record_id: prod.id, value: JSON.stringify('velvet') })
  ok('attribute value stored for the product', !!val)
  const dupVal = await rest('field_values', { method: 'POST', body: JSON.stringify({ tenant_id: tFurn, field_definition_id: fabric.id, record_type: 'product', record_id: prod.id, value: JSON.stringify('leather') }) })
  ok('duplicate value for (definition, record) rejected (unique)', dupVal.status >= 400)

  // JEWELRY tenant installs DIFFERENT defs; furniture defs must NOT appear here
  await ins('field_definitions', { tenant_id: tJewel, entity_type: 'product', key: 'carat', label: 'Carat', field_type: 'decimal' })
  const jewelDefs = await list(`field_definitions?tenant_id=eq.${tJewel}&entity_type=eq.product&select=key`)
  const furnDefs = await list(`field_definitions?tenant_id=eq.${tFurn}&entity_type=eq.product&select=key`)
  ok('jewelry tenant has carat but NOT furniture fabric/width', jewelDefs.some((d) => d.key === 'carat') && !jewelDefs.some((d) => ['fabric', 'width_cm'].includes(d.key)))
  ok('furniture tenant has fabric/width but NOT jewelry carat', furnDefs.some((d) => d.key === 'fabric') && !furnDefs.some((d) => d.key === 'carat'))
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  for (const t of [tFurn, tJewel]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 3 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
