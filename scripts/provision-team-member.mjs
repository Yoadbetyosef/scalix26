// Put a person inside an EXISTING business: one auth user, one active tenant_members row.
//
// This is the manual-provisioning counterpart to the Team screen. The screen mints a Supabase link and
// lets the person choose their own password, which is the right default. This exists for the case the
// screen cannot serve — an internal or hand-set-up account where an operator needs the password to be
// a known value — and it produces EXACTLY the same end state: same table, same role vocabulary, same
// 'active' status. There is no second code path into a business.
//
//   printf '%s' 'the-password' | node scripts/provision-team-member.mjs \
//       --email info@example.com --tenant <uuid> --role staff
//
// The password is read from STDIN so it never lands in argv (visible in `ps`), in an env var, or on
// disk. Nothing secret is printed: not the password, not its hash, not the service key, not a token.
//
// IDEMPOTENT in both directions. Re-running it updates the password and the membership rather than
// creating a second of either. It NEVER writes tenants.user_id, so it cannot transfer ownership, and
// it refuses outright to touch a row whose role is 'owner'.
import { readFileSync } from 'node:fs'

// ── inputs ──────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null }

const EMAIL = (arg('email') || '').trim().toLowerCase()
const TENANT = (arg('tenant') || '').trim()
const ROLE = (arg('role') || 'staff').trim()
const DRY = argv.includes('--dry-run')

if (!EMAIL || !TENANT) {
  console.error('usage: printf %s \'<password>\' | node scripts/provision-team-member.mjs --email <e> --tenant <uuid> [--role staff|manager] [--dry-run]')
  process.exit(2)
}
if (!['staff', 'manager'].includes(ROLE)) {
  console.error(`refusing role "${ROLE}" — only staff or manager. Ownership is never granted this way.`)
  process.exit(2)
}

const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '')
if (!DRY && password.length < 8) { console.error('password must be at least 8 characters (read from stdin)'); process.exit(2) }

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const api = async (path, init = {}) => {
  const res = await fetch(`${SB}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

// ── 1. the business must exist, and must not be about to acquire a second owner ────────────────────
const t = await api(`/rest/v1/tenants?select=id,business_name,user_id,suspended_at&id=eq.${TENANT}`)
if (!t.ok || !t.body?.length) { console.error(`tenant ${TENANT} not found`); process.exit(1) }
const tenant = t.body[0]
console.log(`business : ${tenant.business_name}  (${tenant.id})`)
console.log(`owner    : ${tenant.user_id || '(none)'}${tenant.suspended_at ? '  ⚠ SUSPENDED' : ''}`)
const ownerBefore = tenant.user_id

// ── 2. the membership table has to be there ────────────────────────────────────────────────────────
const probe = await api('/rest/v1/tenant_members?select=id&limit=1')
if (!probe.ok) {
  console.error(`\n✗ tenant_members is not reachable (HTTP ${probe.status}).`)
  console.error('  Run supabase/migrations/add_tenant_members.sql first. Creating the auth user without')
  console.error('  a membership row would leave this person able to sign in with NO business, and')
  console.error('  /dashboard sends a user with no tenant to /setup — which creates one.')
  process.exit(1)
}

// ── 3. the auth user: create, or adopt the existing one ────────────────────────────────────────────
// Paged so a project with more users than one page still finds them. Supabase's admin list has no
// exact-email filter, hence the scan.
let userId = null
for (let page = 1; page <= 20 && !userId; page++) {
  const r = await api(`/auth/v1/admin/users?page=${page}&per_page=200`)
  const users = r.body?.users ?? []
  if (!users.length) break
  const hit = users.find((u) => (u.email || '').toLowerCase() === EMAIL)
  if (hit) userId = hit.id
}

if (DRY) {
  console.log(`\n[dry run] would ${userId ? `update existing auth user ${userId}` : 'create a new auth user'} for ${EMAIL}`)
  console.log(`[dry run] would set membership tenant=${TENANT} role=${ROLE} status=active`)
  process.exit(0)
}

if (userId) {
  console.log(`auth user: found existing ${userId} — adopting it, not creating a duplicate`)
  const upd = await api(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ password, email_confirm: true }),
  })
  if (!upd.ok) { console.error(`✗ could not update the auth user (HTTP ${upd.status})`); process.exit(1) }
  console.log('auth user: password set, email confirmed')
} else {
  const created = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
  })
  if (!created.ok || !created.body?.id) { console.error(`✗ could not create the auth user (HTTP ${created.status})`); process.exit(1) }
  userId = created.body.id
  console.log(`auth user: created ${userId}, password set, email confirmed`)
}

// ── 4. the membership ──────────────────────────────────────────────────────────────────────────────
const existing = await api(`/rest/v1/tenant_members?select=id,role,status&tenant_id=eq.${TENANT}&user_id=eq.${userId}`)
const prev = existing.body?.[0]
const now = new Date().toISOString()

if (prev?.role === 'owner') {
  console.error('\n✗ that user is the OWNER of this business. Refusing to rewrite an owner row.')
  process.exit(1)
}

let memberId
if (prev) {
  const upd = await api(`/rest/v1/tenant_members?id=eq.${prev.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ role: ROLE, status: 'active', invited_email: EMAIL, accepted_at: now, updated_at: now }),
  })
  if (!upd.ok) { console.error(`✗ could not update the membership (HTTP ${upd.status})`, upd.body); process.exit(1) }
  memberId = upd.body?.[0]?.id
  console.log(`membership: updated ${memberId} → role=${ROLE} status=active`)
} else {
  const ins = await api('/rest/v1/tenant_members', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      tenant_id: TENANT, user_id: userId, role: ROLE, status: 'active',
      invited_email: EMAIL, invited_at: now,
      // Manually provisioned with a known password: she is not "invited and waiting", she is in.
      accepted_at: now,
    }),
  })
  if (!ins.ok) { console.error(`✗ could not create the membership (HTTP ${ins.status})`, ins.body); process.exit(1) }
  memberId = ins.body?.[0]?.id
  console.log(`membership: created ${memberId} → role=${ROLE} status=active`)
}

// ── 5. prove we changed nothing we promised not to ────────────────────────────────────────────────
const after = await api(`/rest/v1/tenants?select=id,user_id&id=eq.${TENANT}`)
const ownerAfter = after.body?.[0]?.user_id
console.log(`\nowner unchanged     : ${ownerAfter === ownerBefore ? 'yes' : 'NO — STOP'}`)

const owned = await api(`/rest/v1/tenants?select=id,business_name&user_id=eq.${userId}`)
console.log(`owns no tenant      : ${owned.body?.length ? `NO — owns ${owned.body.length}, this would outrank membership` : 'yes'}`)

const actives = await api(`/rest/v1/tenant_members?select=id,tenant_id&user_id=eq.${userId}&status=eq.active`)
console.log(`active memberships  : ${actives.body?.length ?? 0} (expect 1)`)

console.log(`\nauth_uid      : ${userId}`)
console.log(`membership_id : ${memberId}`)
console.log(`tenant_id     : ${TENANT}`)
console.log(`role/status   : ${ROLE} / active`)
