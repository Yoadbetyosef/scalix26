// Install the FURNITURE product schema for one tenant as the first consumer of the generic attribute
// engine — proving verticalization = configuration, not Core columns. Jewelry/etc. install different
// definitions the same way. RUN AFTER add_core_3_product_schema.sql.
//   node scripts/seed-furniture-schema.mjs <tenant_id | tenant_slug>
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })

const arg = process.argv[2]
if (!arg) { console.error('usage: node scripts/seed-furniture-schema.mjs <tenant_id|slug>'); process.exit(1) }
const t = (await (await rest(`tenants?or=(id.eq.${arg},slug.eq.${arg})&select=id,business_name`)).json())[0]
if (!t) { console.error('tenant not found:', arg); process.exit(1) }

// entity_type='product' definitions — furniture attributes (NOT Core columns).
const defs = [
  { key: 'fabric', label: 'Fabric', field_type: 'select', options: ['velvet', 'leather', 'linen', 'cotton', 'boucle'] },
  { key: 'width_cm', label: 'Width (cm)', field_type: 'decimal', validation: { min: 0 } },
  { key: 'height_cm', label: 'Height (cm)', field_type: 'decimal', validation: { min: 0 } },
  { key: 'depth_cm', label: 'Depth (cm)', field_type: 'decimal', validation: { min: 0 } },
]
let sort = 0
for (const d of defs) {
  const [row] = await (await rest('field_definitions', { method: 'POST', body: JSON.stringify({ tenant_id: t.id, entity_type: 'product', key: d.key, label: d.label, field_type: d.field_type, validation: d.validation || {}, sort_order: sort++ }) })).json()
  if (d.options && row?.id) {
    await rest('field_options', { method: 'POST', body: JSON.stringify(d.options.map((v, i) => ({ tenant_id: t.id, field_definition_id: row.id, value: v, label: v[0].toUpperCase() + v.slice(1), sort_order: i }))) })
  }
  console.log(`  installed product.${d.key} (${d.field_type})`)
}
console.log(`\n✅ Furniture schema installed for "${t.business_name}" — fabric + width/height/depth as configurable attributes.`)
