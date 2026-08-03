// Load a tenant's product-name list into catalog_product_names, for the Add Product form's
// suggest-as-you-type field.
//
// Takes a JSON file of [{ name, category }] — produced from whatever spreadsheet the business keeps —
// so the list can be refreshed whenever their range changes. Idempotent: a name already on file is left
// alone (its category is refreshed), and nothing is ever deleted, so a name retired in the sheet but
// still referenced by existing products stays intact.
//
//   Run: node scripts/seed-product-names.mjs <tenant-id> <path-to.json>
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const [tenantId, jsonPath] = process.argv.slice(2)
if (!tenantId || !jsonPath) { console.error('Usage: node scripts/seed-product-names.mjs <tenant-id> <path-to.json>'); process.exit(1) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const rows = JSON.parse(readFileSync(jsonPath, 'utf8'))
if (!Array.isArray(rows) || !rows.length) { console.error('That JSON file has no rows.'); process.exit(1) }

// Confirm the tenant is real and has the catalog module, so a typo'd id can't quietly seed nothing.
const [tenant] = await (await fetch(`${SB}/rest/v1/tenants?select=id,business_name,enabled_modules&id=eq.${tenantId}`, { headers: H })).json()
if (!tenant) { console.error(`No tenant with id ${tenantId}.`); process.exit(1) }
if (!(tenant.enabled_modules ?? []).includes('inventory')) {
  console.error(`"${tenant.business_name}" does not have the inventory (catalog) module enabled.`); process.exit(1)
}
console.log(`Tenant: ${tenant.business_name}`)

// Diff against what's already there rather than relying on ON CONFLICT: uniqueness is enforced by an
// EXPRESSION index (tenant_id, lower(name)), which PostgREST's on_conflict can't reference. Comparing
// here is also what makes the case-insensitive match — "Athena Sofa" vs "athena sofa" — behave.
const existing = await (await fetch(`${SB}/rest/v1/catalog_product_names?select=id,name,category&tenant_id=eq.${tenantId}`, { headers: H })).json()
const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r]))
console.log(`Already on file: ${existing.length}`)

const clean = rows
  .map((r) => ({ name: String(r.name ?? '').trim(), category: r.category ? String(r.category).trim() : null }))
  .filter((r) => r.name)
const toInsert = []
const toUpdate = []
const seen = new Set()
for (const r of clean) {
  const k = r.name.toLowerCase()
  if (seen.has(k)) continue          // the sheet itself can repeat a name across tabs
  seen.add(k)
  const hit = byName.get(k)
  if (!hit) toInsert.push({ tenant_id: tenantId, name: r.name, category: r.category, active: true })
  else if ((hit.category ?? null) !== r.category) toUpdate.push({ id: hit.id, category: r.category })
}

let written = 0
for (let i = 0; i < toInsert.length; i += 200) {
  const res = await fetch(`${SB}/rest/v1/catalog_product_names`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(toInsert.slice(i, i + 200)),
  })
  const body = await res.json()
  if (!res.ok) { console.error('Insert failed:', JSON.stringify(body)); process.exit(1) }
  written += body.length
}
// Refresh categories on names already present, so re-running after a re-categorised sheet is meaningful.
for (const u of toUpdate) {
  await fetch(`${SB}/rest/v1/catalog_product_names?id=eq.${u.id}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ category: u.category }),
  })
}
console.log(`New: ${written}   Re-categorised: ${toUpdate.length}   Unchanged: ${seen.size - written - toUpdate.length}`)

const cats = await (await fetch(`${SB}/rest/v1/catalog_product_names?select=category&tenant_id=eq.${tenantId}`, { headers: H })).json()
console.log(`\nNow on file: ${cats.length}`)
const by = {}
for (const c of cats) by[c.category ?? '(no category)'] = (by[c.category ?? '(no category)'] ?? 0) + 1
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
