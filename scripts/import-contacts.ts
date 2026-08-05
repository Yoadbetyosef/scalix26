// Load a prepared contact list into a tenant's contact book — the CLI counterpart to the in-app
// importer (Contacts → Import), for a book too big or too messy to paste through the browser.
//
// Takes a JSON file of ImportRow ([{ name, email, phone, address, currency, notes }]) — produced from
// whatever spreadsheet or accounting export the business keeps — so the mapping step stays where it
// belongs: with the file. Everything after that is the SAME logic the app uses:
//   • the normalizers from lib/contacts/store.ts decide what counts as the same person
//   • a row matching an existing contact by email or phone is never written
//   • rows that repeat each other within the file collapse to one
//   • normalized_email / normalized_phone are written, so merge and the order-form picker keep working
// One addition the in-app importer doesn't need: a row with NO email and NO phone is matched on name
// as well, so re-running this script can't fill the book with duplicates of name-only rows.
//
// --enrich handles the other half of the problem: a contact the app created from a single inbound
// email has nothing but that address, so it reads as "Unknown" everywhere. When the business later
// produces the file that names them, --enrich fills the empty columns on the matched record. It only
// ever writes into a blank — an existing value is never overwritten, because what the business
// already corrected in the app outranks what the export says.
//
// Dry run by default — it prints exactly what would happen and writes nothing. Add --commit to write.
//
//   Run: node_modules/.bin/tsx scripts/import-contacts.ts <tenant-id> <rows.json> [--enrich] [--commit]
import { readFileSync } from 'node:fs'
import { normalizeEmail, normalizePhone, type ImportRow, type ContactSummary } from '../lib/contacts/store'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const enrich = args.includes('--enrich')
const [tenantId, jsonPath] = args.filter((a) => !a.startsWith('--'))

// The list query pulls notes too, which enrich needs and the dedupe pass ignores.
type ExistingContact = ContactSummary & { notes: string | null }

;(async () => {
  if (!tenantId || !jsonPath) {
    console.error('Usage: node_modules/.bin/tsx scripts/import-contacts.ts <tenant-id> <rows.json> [--enrich] [--commit]')
    process.exit(1)
  }
  const rows: ImportRow[] = JSON.parse(readFileSync(jsonPath, 'utf8'))
  if (!Array.isArray(rows) || !rows.length) { console.error('That JSON file has no rows.'); process.exit(1) }

  // Confirm the tenant is real and actually has a contact book, so a typo'd id can't quietly write nowhere.
  const [tenant] = await (await fetch(`${SB}/rest/v1/tenants?select=id,business_name,enabled_modules&id=eq.${tenantId}`, { headers: H })).json()
  if (!tenant) { console.error(`No tenant with id ${tenantId}.`); process.exit(1) }
  if (!(tenant.enabled_modules ?? []).includes('contacts')) {
    console.error(`"${tenant.business_name}" does not have the contacts module enabled.`); process.exit(1)
  }
  console.log(`Tenant: ${tenant.business_name}   Rows in file: ${rows.length}   ${commit ? 'COMMIT' : 'dry run'}`)

  // Every live contact for the tenant, matching lib/contacts/store.ts loadExisting: merged-away records
  // are excluded so a contact folded into another can't block its survivor from matching.
  const existing: ExistingContact[] = await (await fetch(
    `${SB}/rest/v1/contacts?select=id,name,email,phone,address,currency,notes&tenant_id=eq.${tenantId}&merged_into_id=is.null&limit=10000`,
    { headers: H },
  )).json()
  console.log(`Already in the book: ${existing.length}`)

  // Keys come from the raw email/phone rather than normalized_email/normalized_phone, because contacts
  // created before those columns existed still have them null.
  const byEmail = new Map<string, ExistingContact>()
  const byPhone = new Map<string, ExistingContact>()
  const byName = new Map<string, ExistingContact>()
  for (const r of existing) {
    const e = normalizeEmail(r.email); if (e && !byEmail.has(e)) byEmail.set(e, r)
    const p = normalizePhone(r.phone); if (p && !byPhone.has(p)) byPhone.set(p, r)
    const n = (r.name ?? '').trim().toLowerCase(); if (n && !byName.has(n)) byName.set(n, r)
  }

  const toCreate: ImportRow[] = []
  const duplicates: Array<{ row: ImportRow; existing: ExistingContact; reason: string }> = []
  const skipped: Array<{ row: ImportRow; reason: string }> = []
  const seenEmail = new Set<string>(); const seenPhone = new Set<string>(); const seenName = new Set<string>()

  for (const row of rows) {
    const name = (row.name ?? '').trim()
    const e = normalizeEmail(row.email); const p = normalizePhone(row.phone)
    const n = name.toLowerCase()
    if (!name && !e && !p) { skipped.push({ row, reason: 'No name, email, or phone' }); continue }
    if (e && byEmail.has(e)) { duplicates.push({ row, existing: byEmail.get(e)!, reason: 'email' }); continue }
    if (p && byPhone.has(p)) { duplicates.push({ row, existing: byPhone.get(p)!, reason: 'phone' }); continue }
    // Name-only rows have no other key to match on; without this a second run would double the book.
    if (!e && !p && n && byName.has(n)) { duplicates.push({ row, existing: byName.get(n)!, reason: 'name' }); continue }
    if ((e && seenEmail.has(e)) || (p && seenPhone.has(p)) || (!e && !p && n && seenName.has(n))) {
      skipped.push({ row, reason: 'Repeated earlier in this file' }); continue
    }
    if (e) seenEmail.add(e); if (p) seenPhone.add(p); if (n) seenName.add(n)
    toCreate.push(row)
  }

  console.log(`\nNew: ${toCreate.length}   Already in the book: ${duplicates.length}   Skipped: ${skipped.length}`)
  for (const d of duplicates) console.log(`  dup (${d.reason})  ${d.row.name ?? '—'}  ←→  ${d.existing.name ?? d.existing.email ?? d.existing.phone}`)
  for (const s of skipped) console.log(`  skip (${s.reason})  ${s.row.name ?? s.row.email ?? s.row.phone ?? '—'}`)

  // What --enrich would add to the records the rows above matched: blank columns only.
  const FIELDS = ['name', 'phone', 'address', 'currency', 'notes'] as const
  const patches: Array<{ id: string; label: string; patch: Record<string, string | null> }> = []
  if (enrich) {
    for (const d of duplicates) {
      const patch: Record<string, string | null> = {}
      for (const f of FIELDS) {
        const incoming = (d.row[f] ?? '').trim()
        if (incoming && !(d.existing[f as keyof ExistingContact] ?? '')) patch[f] = incoming
      }
      // A phone arriving into a blank column has to carry its match key with it, or the next import
      // won't recognise the person it just filled in.
      if (patch.phone) patch.normalized_phone = normalizePhone(patch.phone)
      if (Object.keys(patch).length) {
        patches.push({ id: d.existing.id, label: d.existing.name ?? d.existing.email ?? d.existing.phone ?? d.existing.id, patch })
      }
    }
    console.log(`\nTo enrich: ${patches.length}`)
    for (const p of patches) console.log(`  ${p.label}  +  ${Object.keys(p.patch).filter((k) => k !== 'normalized_phone').join(', ')}`)
  }

  if (!commit) {
    console.log('\nDry run — nothing written. Re-run with --commit to write.')
    if (toCreate.length) {
      console.log('First 3 new rows as they would be stored:')
      for (const r of toCreate.slice(0, 3)) console.log(' ', JSON.stringify(r))
    }
    return
  }

  // Same payload shape as commitImport, so a CLI-loaded contact is indistinguishable from an app-loaded one.
  const payload = toCreate.map((r) => ({
    tenant_id: tenantId,
    name: (r.name ?? '').trim() || null, email: (r.email ?? '').trim() || null, phone: (r.phone ?? '').trim() || null,
    address: (r.address ?? '').trim() || null, currency: (r.currency ?? '').trim() || null, notes: (r.notes ?? '').trim() || null,
    normalized_email: normalizeEmail(r.email), normalized_phone: normalizePhone(r.phone),
    total_conversations: 0,
  }))

  let created = 0
  for (let i = 0; i < payload.length; i += 500) {
    const res = await fetch(`${SB}/rest/v1/contacts`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify(payload.slice(i, i + 500)),
    })
    const body = await res.json()
    if (!res.ok) { console.error('Insert failed:', JSON.stringify(body)); process.exit(1) }
    created += body.length
  }
  console.log(`\nWritten: ${created}`)

  let enriched = 0
  for (const p of patches) {
    const res = await fetch(`${SB}/rest/v1/contacts?id=eq.${p.id}&tenant_id=eq.${tenantId}`, {
      method: 'PATCH', headers: H, body: JSON.stringify(p.patch),
    })
    if (!res.ok) { console.error(`Enrich failed for ${p.label}:`, await res.text()); process.exit(1) }
    enriched++
  }
  if (enrich) console.log(`Enriched: ${enriched}`)

  const after = await (await fetch(`${SB}/rest/v1/contacts?select=id&tenant_id=eq.${tenantId}&merged_into_id=is.null&limit=10000`, { headers: H })).json()
  console.log(`Contact book now holds: ${after.length}`)
})()
