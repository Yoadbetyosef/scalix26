// Prove, against the REAL database, that a business has the team members it should — and that the
// membership machinery is actually installed.
//
// READ-ONLY. It writes nothing and changes nothing. Run it before the migration to see what is
// missing, and after inviting somebody to confirm they landed on the RIGHT tenant rather than a
// second one of their own.
//
//   node scripts/verify-team-access.mjs                          # every business with >1 member
//   node scripts/verify-team-access.mjs "Your Design"            # one business by name
//   node scripts/verify-team-access.mjs "Your Design" info@yourdesignco.com
//
// The service key is read from .env.local by this script, the same way every other verify-* script
// does it. It is never passed on a command line and never printed.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const rest = async (path) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

const [nameQuery, emailQuery] = process.argv.slice(2)
let failures = 0
const fail = (m) => { failures++; console.log(`  ✗ ${m}`) }
const pass = (m) => console.log(`  ✓ ${m}`)

console.log('\n── 1. Is the membership machinery installed? ──────────────────────────')

const probe = await rest('tenant_members?select=id&limit=1')
if (!probe.ok) {
  console.log(`  ✗ tenant_members is NOT reachable (HTTP ${probe.status}).`)
  console.log('    → supabase/migrations/add_tenant_members.sql has not been run yet.')
  console.log('    Everything below will be empty. The app is unaffected: the resolver falls back')
  console.log('    to owner-only, which is exactly how it behaved before team accounts existed.\n')
  process.exit(1)
}
pass('tenant_members exists')

// The function body is the other half. A table with no membership-aware get_tenant_id() means the
// app resolves a team member correctly while RLS still refuses her browser-side reads.
const fn = await rest('rpc/get_tenant_id')
console.log(fn.ok
  ? '  · get_tenant_id() is callable (its body is checked by PART 5 of the migration, not from here)'
  : `  · get_tenant_id() not callable as RPC (${fn.status}) — normal; it is a policy helper, not an API`)

console.log('\n── 2. Businesses and their people ────────────────────────────────────')

const tenantFilter = nameQuery ? `&business_name=ilike.*${encodeURIComponent(nameQuery)}*` : ''
const tenants = await rest(`tenants?select=id,business_name,user_id,suspended_at${tenantFilter}&order=business_name`)
if (!tenants.ok) { console.log(`  ✗ could not read tenants (HTTP ${tenants.status})`); process.exit(1) }

const members = await rest('tenant_members?select=id,tenant_id,user_id,invited_email,role,status,accepted_at&status=neq.disabled')
if (!members.ok) { console.log(`  ✗ could not read tenant_members (HTTP ${members.status})`); process.exit(1) }

const byTenant = new Map()
for (const m of members.body) {
  if (!byTenant.has(m.tenant_id)) byTenant.set(m.tenant_id, [])
  byTenant.get(m.tenant_id).push(m)
}

const shown = tenants.body.filter((t) => nameQuery || (byTenant.get(t.id) || []).length > 1)
if (!shown.length) {
  console.log(nameQuery ? `  (no business matching "${nameQuery}")` : '  (no business has more than one member yet)')
}

for (const t of shown) {
  const rows = byTenant.get(t.id) || []
  console.log(`\n  ${t.business_name}`)
  console.log(`    tenant_id : ${t.id}`)
  console.log(`    owner     : ${t.user_id || '(none)'}${t.suspended_at ? '   ⚠ SUSPENDED' : ''}`)
  if (!rows.length) { console.log('    members   : (none — not even the owner row; PART 4 backfill may not have run)'); continue }
  for (const m of rows) {
    const state = m.accepted_at ? 'active' : 'invited (not signed in yet)'
    console.log(`    · ${(m.invited_email || '(owner)').padEnd(34)} ${m.role.padEnd(8)} ${state}`)
  }
}

if (emailQuery) {
  console.log('\n── 3. One person, checked properly ───────────────────────────────────')
  const target = emailQuery.toLowerCase()
  const hits = members.body.filter((m) => (m.invited_email || '').toLowerCase() === target)

  if (!hits.length) fail(`${target} is not an active member of any business`)
  else if (hits.length > 1) fail(`${target} is active on ${hits.length} businesses — uq_tenant_member_active_user should have prevented this`)
  else {
    const m = hits[0]
    const t = tenants.body.find((x) => x.id === m.tenant_id)
      || (await rest(`tenants?select=id,business_name,user_id&id=eq.${m.tenant_id}`)).body?.[0]
    pass(`${target} is a member of exactly one business: ${t?.business_name ?? m.tenant_id}`)
    pass(`role: ${m.role}`)
    if (m.role === 'owner') fail('they are recorded as OWNER — a staff invite should never produce this')
    console.log(`  · signed in yet: ${m.accepted_at ? `yes (${m.accepted_at})` : 'no — invitation still outstanding'}`)

    // THE POINT OF THE WHOLE EXERCISE: she must not have acquired a business of her own, because
    // getActiveWorkspace() checks ownership FIRST and a tenant of her own would outrank her membership.
    if (m.user_id) {
      const owned = await rest(`tenants?select=id,business_name&user_id=eq.${m.user_id}`)
      if (owned.ok && owned.body.length) {
        fail(`they ALSO own a tenant (${owned.body.map((x) => x.business_name).join(', ')}) — ownership wins over membership, so they would land there instead`)
      } else {
        pass('they own no tenant of their own — membership is their only route in, as intended')
      }
    } else {
      fail('the membership row has no user_id — they cannot sign in against it')
    }
  }
}

console.log(`\n${failures ? `✗ ${failures} problem(s)` : '✓ all checks passed'}\n`)
process.exit(failures ? 1 : 0)
