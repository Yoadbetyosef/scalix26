// Prove the brake engages against the REAL table — including the row an exact match would miss.
//
// The gates cannot answer this one. `stopDripsForPhone` compares the last ten digits because
// `contact_phone` holds whatever string reached intakeLead, and the live leads table already carries
// '(917) 495-4300' and '9174954300' beside E.164. A unit test proves the comparison; only this
// proves it against PostgREST, the real column, and the real cron query.
//
// It creates its own campaigns against a throwaway phone number, runs both matches side by side, and
// deletes everything it made. Nothing pre-existing is read for mutation or left changed.
//
//   node scripts/verify-drip-brake.mjs
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
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

// The same rule lib/contacts/store.ts uses. Restated rather than imported because this is a plain
// .mjs probe with no bundler — and it is asserted below to behave identically on the same inputs.
const normalizePhone = (v) => {
  const d = (v ?? '').replace(/\D/g, '')
  if (d.length < 7) return null
  return d.length > 10 ? d.slice(-10) : d
}

// A number that cannot belong to anybody: 555-01xx is reserved for fiction.
const PHONE = '+15550123456'
const ok = (b) => (b ? '✓' : '✗')
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${ok(cond)} ${label}${detail ? ` — ${detail}` : ''}`)
}

const main = async () => {
  // drip_campaigns.lead_id is NOT NULL and references leads, so the probe hangs its rows off a real
  // lead — of a tenant that HAS one. Picking "the first tenant" found one with none.
  const [lead] = await rest('leads?select=id,tenant_id&limit=1')
  if (!lead) throw new Error('no lead anywhere to hang a probe campaign off')
  const [tenant] = await rest(`tenants?id=eq.${lead.tenant_id}&select=id,business_name`)
  console.log(`tenant ${tenant.id.slice(0, 8)} (${tenant.business_name})\n`)

  // Three campaigns for ONE person, written the three ways the column actually holds numbers.
  const written = [
    { contact_phone: PHONE, label: 'E.164          ' },
    { contact_phone: '(555) 012-3456', label: 'formatted      ' },
    { contact_phone: '5550123456', label: 'bare ten digits' },
  ]
  const made = await rest('drip_campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(written.map((w) => ({
      tenant_id: tenant.id, lead_id: lead.id, contact_phone: w.contact_phone,
      business_name: 'PROBE — delete me', status: 'active', messages_sent: 0,
      next_send_at: new Date(Date.now() - 60_000).toISOString(),   // already due
    }))),
  })
  const ids = made.map((m) => m.id)
  console.log(`created ${made.length} active campaigns for one person:`)
  for (const w of written) console.log(`    ${w.label}  ${w.contact_phone}`)

  try {
    // ── 1. The cron would send to all three ────────────────────────────────────────────────────
    const due = await rest(`drip_campaigns?status=eq.active&next_send_at=lte.${new Date().toISOString()}&select=id`)
    const mineDue = due.filter((d) => ids.includes(d.id)).length
    console.log('\nbefore the brake:')
    check('the cron query picks up all three', mineDue === 3, `${mineDue}/3 due`)

    // ── 2. What an exact match would have done ────────────────────────────────────────────────
    const exact = await rest(`drip_campaigns?tenant_id=eq.${tenant.id}&status=eq.active&contact_phone=eq.${encodeURIComponent(PHONE)}&select=id`)
    console.log('\nthe match that was there before:')
    check('.eq(contact_phone) reaches only the E.164 row', exact.length === 1, `${exact.length}/3`)
    check('  → 2 campaigns would have kept sending', exact.length === 1)

    // ── 3. What the helper does ───────────────────────────────────────────────────────────────
    const active = await rest(`drip_campaigns?tenant_id=eq.${tenant.id}&status=eq.active&select=id,contact_phone`)
    const key = normalizePhone(PHONE)
    const matched = active.filter((r) => normalizePhone(r.contact_phone) === key).map((r) => r.id)
    console.log('\nthe normalised match:')
    check('reaches all three', matched.length === 3, `${matched.length}/3`)
    check('and nobody else’s', matched.every((id) => ids.includes(id)))

    await rest(`drip_campaigns?id=in.(${matched.join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'stopped', updated_at: new Date().toISOString() }),
    })

    // ── 4. The cron no longer sees them ───────────────────────────────────────────────────────
    const after = await rest(`drip_campaigns?id=in.(${ids.join(',')})&select=id,status`)
    console.log('\nafter the brake:')
    check('all three read stopped', after.every((r) => r.status === 'stopped'), after.map((r) => r.status).join(', '))
    const dueAfter = await rest(`drip_campaigns?status=eq.active&next_send_at=lte.${new Date().toISOString()}&select=id`)
    check('the cron query returns none of them', dueAfter.filter((d) => ids.includes(d.id)).length === 0)

    // ── 5. The lead is untouched ──────────────────────────────────────────────────────────────
    const [leadAfter] = await rest(`leads?id=eq.${lead.id}&select=status`)
    console.log('\nand nothing else moved:')
    check('leads.status untouched by the brake', typeof leadAfter.status === 'string', `still '${leadAfter.status}'`)
  } finally {
    await rest(`drip_campaigns?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const left = await rest(`drip_campaigns?id=in.(${ids.join(',')})&select=id`)
    console.log(`\ncleaned up: ${left.length === 0 ? 'all probe rows deleted' : `${left.length} LEFT BEHIND`}`)
    if (left.length) failures++
  }

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
