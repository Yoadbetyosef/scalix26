// Prove the two policies differ where they should and agree where they must — against the REAL table.
//
// The gates check that the code says the right thing. They cannot check that the slot grid on THIS
// database actually refuses the AI and admits the owner, that the partial unique index really raises
// 23505, or that a contact already in the book is matched by digits rather than duplicated. Those are
// facts about Postgres and about live data.
//
// Writes only rows it creates, and deletes all of them.
//
//   node scripts/verify-owner-create.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const rest = async (path, init = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

const TENANT = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5'
const PHONE = '+15550127777'
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const normalize = (v) => {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length < 7 ? null : d.length > 10 ? d.slice(-10) : d
}

const main = async () => {
  const made = { appts: [], contacts: [] }
  try {
    // ── The grid, as it actually is ───────────────────────────────────────────────────────────
    const grid = (await rest(`appointment_slots?tenant_id=eq.${TENANT}&select=day_of_week,slot_time&is_active=eq.true`)).body
    const dows = new Set(grid.map((g) => g.day_of_week))
    console.log(`slot grid: ${grid.length} active rows on ${dows.size} of 7 weekdays`)
    check('the grid does NOT cover every day — which is why the owner is not held to it', dows.size < 7,
      `covered: ${[...dows].sort().join(',')}`)

    // Find a date in the next 14 days the grid does NOT cover.
    let uncovered = null
    for (let i = 1; i <= 14 && !uncovered; i++) {
      const d = new Date(Date.now() + i * 86400000)
      const iso = d.toISOString().slice(0, 10)
      if (!dows.has(d.getUTCDay())) uncovered = iso
    }
    check('there is a date in the next fortnight the AI could not offer', !!uncovered, uncovered ?? 'none')

    // ── The owner's policy books it; the AI's would not ───────────────────────────────────────
    console.log('\nthe owner books a day the grid does not cover:')
    const a1 = await rest('appointments', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: TENANT, slot_date: uncovered, slot_time: '07:30:00',
        customer_name: 'Probe Customer', customer_phone: PHONE,
        service_type: 'PROBE — delete me', status: 'confirmed', channel: 'owner',
        meeting_kind: 'on_site', duration_minutes: 45,
      }),
    })
    check('the row is written', a1.ok && a1.body?.[0]?.id, a1.body?.[0] ? `${uncovered} 07:30` : JSON.stringify(a1.body))
    if (a1.body?.[0]) made.appts.push(a1.body[0].id)
    check('at a time the grid has no slot for', !grid.some((g) => g.slot_time === '07:30:00'))

    // ── Double-booking is refused for BOTH, by the index ──────────────────────────────────────
    console.log('\nthe same slot, twice:')
    const a2 = await rest('appointments', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: TENANT, slot_date: uncovered, slot_time: '07:30:00',
        customer_phone: PHONE, status: 'confirmed', channel: 'owner', meeting_kind: 'on_site',
      }),
    })
    if (a2.body?.[0]) made.appts.push(a2.body[0].id)
    check('refused by the database, not by a check that could be forgotten', !a2.ok, `status ${a2.status}`)
    check('and it is the unique index that did it', JSON.stringify(a2.body ?? '').includes('uniq_appt_active_slot'))

    // ── The kind constraint ───────────────────────────────────────────────────────────────────
    console.log('\na fifth meeting kind:')
    const a3 = await rest('appointments', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: TENANT, slot_date: uncovered, slot_time: '07:45:00',
        customer_phone: PHONE, status: 'confirmed', meeting_kind: 'teams',
      }),
    })
    if (a3.body?.[0]) made.appts.push(a3.body[0].id)
    check('refused — which is why both routes coerce rather than pass it through', !a3.ok, `status ${a3.status}`)

    // ── The contact is found by digits, not duplicated ────────────────────────────────────────
    console.log('\nthe same person, written three ways:')
    const c1 = await rest('contacts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: TENANT, phone: '(555) 012-7777', name: 'Probe Person' }),
    })
    if (c1.body?.[0]) made.contacts.push(c1.body[0].id)
    const all = (await rest(`contacts?tenant_id=eq.${TENANT}&select=id,phone&merged_into_id=is.null`)).body
    const key = normalize(PHONE)
    const hits = all.filter((c) => normalize(c.phone) === key)
    check('the digits match finds the existing record', hits.length >= 1, `${hits.length} match ${key}`)
    check('an exact-string match would have found NONE of them', !all.some((c) => c.phone === PHONE),
      `stored as ${JSON.stringify(hits[0]?.phone)}`)
  } finally {
    for (const id of made.appts) await rest(`appointments?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    for (const id of made.contacts) await rest(`contacts?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const left = (await rest(`appointments?service_type=eq.PROBE%20—%20delete%20me&select=id`)).body ?? []
    console.log(`\ncleaned up: ${made.appts.length} appointment(s), ${made.contacts.length} contact(s); ${left.length} probe rows left`)
    if (left.length) failures++
  }

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
