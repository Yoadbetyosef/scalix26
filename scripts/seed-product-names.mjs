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

const before = await fetch(`${SB}/rest/v1/catalog_product_names?select=id&tenant_id=eq.${tenantId}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
console.log(`Already on file: ${(before.headers.get('content-range') || '').split('/')[1] ?? '0'}`)

// on_conflict on the case-insensitive unique index → re-running refreshes categories instead of failing.
let written = 0
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200).map((r) => ({
    tenant_id: tenantId,
    name: String(r.name).trim(),
    category: r.category ? String(r.category).trim() : null,
    active: true,
  })).filter((r) => r.name)
  const res = await fetch(`${SB}/rest/v1/catalog_product_names?on_conflict=tenant_id,name`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(chunk),
  })
  const body = await res.json()
  if (!res.ok) { console.error('Insert failed:', JSON.stringify(body)); process.exit(1) }
  written += body.length
}

const after = await fetch(`${SB}/rest/v1/catalog_product_names?select=id&tenant_id=eq.${tenantId}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
const total = (after.headers.get('content-range') || '').split('/')[1]
console.log(`Wrote ${written} rows. Now on file: ${total}`)

const cats = await (await fetch(`${SB}/rest/v1/catalog_product_names?select=category&tenant_id=eq.${tenantId}`, { headers: H })).json()
const by = {}
for (const c of cats) by[c.category ?? '(no category)'] = (by[c.category ?? '(no category)'] ?? 0) + 1
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
