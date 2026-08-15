// Prove the manual_fields guard against the REAL table.
//
// The gates cannot answer this one: `.not('manual_fields','cs','{name}')` is a PostgREST array
// operator, and whether it filters the way the helper assumes is a fact about Postgres, not about
// TypeScript. The failure mode if it does not is silent and bad — the AI keeps overwriting a name an
// owner cleared, which is the exact thing the column was added to stop.
//
// Creates its own throwaway contact, runs the AI's guard against it in each of the three states, and
// deletes it. Nothing pre-existing is written.
//
//   node scripts/verify-contact-edit.mjs
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

let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Exactly the filter lib/contacts/ai-name.ts applies, as a URL. */
const aiWrite = (id, name) =>
  rest(`contacts?id=eq.${id}&name=is.null&manual_fields=not.cs.%7Bname%7D`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  })

const main = async () => {
  const [tenant] = await rest('tenants?select=id,business_name&limit=1')
  const [made] = await rest('contacts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ tenant_id: tenant.id, phone: '+15550129999', channel: 'sms' }),
  })
  console.log(`tenant ${tenant.id.slice(0, 8)} · probe contact ${made.id.slice(0, 8)}\n`)

  try {
    check('starts with no name and nothing decided', made.name === null && Array.isArray(made.manual_fields) && made.manual_fields.length === 0)

    // 1. Nobody has decided → the AI may write.
    const first = await aiWrite(made.id, 'Sarah Okonkwo')
    console.log('\nnobody has decided:')
    check('the AI write lands', first.length === 1 && first[0].name === 'Sarah Okonkwo', first[0]?.name)

    // 2. A name exists → the null check alone already stops it. (Unchanged behaviour.)
    const second = await aiWrite(made.id, 'Somebody Else')
    console.log('\na name already exists:')
    check('the AI write is refused', second.length === 0)

    // 3. THE CASE THE COLUMN EXISTS FOR. The owner clears the name — name is null again, and before
    //    this column the next call would have written straight over the decision.
    await rest(`contacts?id=eq.${made.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name: null, manual_fields: ['name'], updated_at: new Date().toISOString() }),
    })
    const [cleared] = await rest(`contacts?id=eq.${made.id}&select=name,manual_fields`)
    console.log('\nthe owner cleared it (name is NULL again):')
    check('name is null and the decision is recorded', cleared.name === null && cleared.manual_fields.includes('name'))

    const third = await aiWrite(made.id, 'Back Again')
    check('the AI write is REFUSED — this is what the column is for', third.length === 0)
    const [after] = await rest(`contacts?id=eq.${made.id}&select=name`)
    check('and the field is still empty', after.name === null, `name=${JSON.stringify(after.name)}`)

    // 4. A decision about one field does not freeze another.
    await rest(`contacts?id=eq.${made.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ manual_fields: ['phone'] }),
    })
    const fourth = await aiWrite(made.id, 'Name Is Free')
    console.log('\na decision about PHONE only:')
    check('the name is not frozen by it', fourth.length === 1, fourth[0]?.name)
  } finally {
    await rest(`contacts?id=eq.${made.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const left = await rest(`contacts?id=eq.${made.id}&select=id`)
    console.log(`\ncleaned up: ${left.length === 0 ? 'probe contact deleted' : 'LEFT BEHIND'}`)
    if (left.length) failures++
  }

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
