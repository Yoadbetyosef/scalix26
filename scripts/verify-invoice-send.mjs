// The send path, against the REAL database.
//
// It does NOT send anything. Nothing here goes to a customer: the probe exercises the half the gates
// cannot see — that a token resolves to exactly one invoice, that the constraint on sent_channel is
// real, that the two writes a send performs land and read back through the same queries the screens
// use, and that a draft's token resolves to a draft (which is what makes /i/ refuse it).
//
// Everything it writes, it undoes.
//
//   node scripts/verify-invoice-send.mjs
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

const NUMBER = 'INV-0002'
let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const main = async () => {
  const all = (await rest('invoices?select=id,tenant_id,number,status,token,sent_at,sent_channel&order=number')).body ?? []
  const inv = all.find((i) => i.number === NUMBER)
  if (!inv) throw new Error(`${NUMBER} not found`)
  const T = inv.tenant_id
  console.log(`${all.length} invoices · ${NUMBER} · status ${inv.status}\n`)

  // ── 1. THE LINK ────────────────────────────────────────────────────────────────────────────
  console.log('the link:')
  check('every invoice has a token', all.every((i) => !!i.token), `${all.filter((i) => i.token).length}/${all.length}`)
  check('and no two share one', new Set(all.map((i) => i.token)).size === all.length)

  // A token must resolve to exactly ONE row. maybeSingle() in the reader ERRORS on two, so a
  // collision would not silently show the wrong invoice — but it would break the page.
  const byToken = (await rest(`invoices?token=eq.${encodeURIComponent(inv.token)}&select=id,status`)).body ?? []
  check('a token resolves to exactly one invoice', byToken.length === 1, `${byToken.length} rows`)
  check('and it is the one it came from', byToken[0]?.id === inv.id)

  // The reader refuses a draft. This is the fact that makes that refusal necessary rather than
  // theoretical: the token exists and is live BEFORE anybody is given it.
  const drafts = all.filter((i) => i.status === 'draft')
  check('drafts already have live tokens, which is why /i/ refuses them', drafts.every((d) => !!d.token), `${drafts.length} drafts`)

  // A token nobody minted resolves to nothing — the same answer a draft gets.
  const nothing = (await rest('invoices?token=eq.definitely-not-a-real-token&select=id')).body ?? []
  check('a made-up token finds nothing', nothing.length === 0)

  // ── 2. THE CONSTRAINT ──────────────────────────────────────────────────────────────────────
  console.log('\nthe constraint:')
  const bad = await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', body: JSON.stringify({ sent_channel: 'carrier-pigeon' }) })
  check('the database refuses a channel that is not email or sms', !bad.ok, `status ${bad.status}`)
  check('and names the constraint', JSON.stringify(bad.body ?? '').includes('sent_channel_check'))

  // ── 3. WHAT A SEND WRITES ──────────────────────────────────────────────────────────────────
  //
  // Both writes, in the order the route performs them, then read back through the queries the list
  // and the detail actually run. NOTHING IS DELIVERED — this is the record a send leaves, not a send.
  const NOTE = 'PROBE — Sent by email to probe@example.com'
  try {
    const first = new Date(Date.now() - 3 * 86_400_000).toISOString()
    await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', body: JSON.stringify({ sent_at: first, sent_channel: 'email' }) })
    await rest('document_status_history', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: T, document_type: 'invoice', document_id: inv.id, from_status: inv.status, to_status: inv.status, note: NOTE }),
    })

    console.log('\nwhat a send writes:')
    const [afterFirst] = (await rest(`invoices?id=eq.${inv.id}&select=sent_at,sent_channel`)).body ?? []
    check('sent_at is stamped', afterFirst?.sent_at?.slice(0, 10) === first.slice(0, 10), afterFirst?.sent_at?.slice(0, 19))
    check('and the channel with it', afterFirst?.sent_channel === 'email')

    // A RESEND. sent_at moves; history does not.
    const second = new Date().toISOString()
    await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', body: JSON.stringify({ sent_at: second, sent_channel: 'sms' }) })
    await rest('document_status_history', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: T, document_type: 'invoice', document_id: inv.id, from_status: inv.status, to_status: inv.status, note: 'PROBE — Sent by SMS to +15550000000' }),
    })

    console.log('\nand what a RESEND does to it:')
    const [afterSecond] = (await rest(`invoices?id=eq.${inv.id}&select=sent_at,sent_channel`)).body ?? []
    check('sent_at now means the MOST RECENT send', afterSecond?.sent_at > afterFirst?.sent_at)
    check('the channel follows it', afterSecond?.sent_channel === 'sms')

    const hist = (await rest(`document_status_history?document_id=eq.${inv.id}&note=like.PROBE*&select=note,from_status,to_status,created_at&order=created_at`)).body ?? []
    check('but BOTH sends survive in history', hist.length === 2, `${hist.length} rows`)
    check('the first one still says when and where it went', hist[0]?.note === NOTE)
    check('and a send is not recorded as a status change', hist.every((h) => h.from_status === h.to_status), hist.map((h) => `${h.from_status}→${h.to_status}`).join(', '))
  } finally {
    console.log('\nundoing:')
    await rest(`document_status_history?document_id=eq.${inv.id}&note=like.PROBE*`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ sent_at: inv.sent_at, sent_channel: inv.sent_channel }) })
    const [back] = (await rest(`invoices?id=eq.${inv.id}&select=status,sent_at,sent_channel,token`)).body ?? []
    const left = (await rest(`document_status_history?document_id=eq.${inv.id}&note=like.PROBE*&select=id`)).body ?? []
    const restored = back?.sent_at === inv.sent_at && back?.sent_channel === inv.sent_channel && back?.token === inv.token && back?.status === inv.status
    console.log(`  ${restored ? '✓' : '✗'} ${NUMBER} is back as it was — never sent, same token`)
    console.log(`  ${left.length === 0 ? '✓' : '✗'} probe history removed (${left.length} left)`)
    if (!restored || left.length) failures++
  }

  // ── 4. THE STUDIO DOCUMENTS ────────────────────────────────────────────────────────────────
  //
  // The promise this whole design was arranged around: four documents are in a real customer's hands
  // on /d/ links, and none of this went near them.
  const sd = (await rest('studio_documents?sent_at=not.is.null&select=id,token,sent_at,sent_channel')).body ?? []
  console.log('\nthe four already in a customer’s hands:')
  check('still sent, still on their own tokens', sd.length >= 4, `${sd.length} sent studio documents`)
  const shared = sd.filter((d) => all.some((i) => i.token === d.token))
  check('and no invoice token collides with one of theirs', shared.length === 0)

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
