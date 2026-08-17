// The ported contact edit, against TG jewellers' REAL contacts. Read-mostly; the one write is undone.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')] }))
const SB = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'content-type': 'application/json' }
const T = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
const rest = async (p, i = {}) => { const r = await fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers ?? {}) } }); return { ok: r.ok, status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) } }
let fail = 0
const check = (l, c, d = '') => { if (!c) fail++; console.log(`  ${c ? '✓' : '✗'} ${l}${d ? ` — ${d}` : ''}`) }

const all = (await rest(`contacts?tenant_id=eq.${T}&select=id,name,email,phone,address,currency,notes,manual_fields`)).body ?? []
console.log(`${all.length} contacts on her tenant\n`)
console.log('the column the whole design rests on:')
check('manual_fields exists on every row', all.every(c => 'manual_fields' in c))
check('and nothing has been marked yet', all.every(c => !c.manual_fields || c.manual_fields.length === 0),
  `${all.filter(c => c.manual_fields?.length).length} marked`)
check('87 nameless contacts are still nameless — nothing was backfilled',
  all.filter(c => !c.name || !String(c.name).trim()).length === 87,
  `${all.filter(c => !c.name || !String(c.name).trim()).length} without a name`)

// One write, on a contact that is already nameless, then undone.
const target = all.find(c => (!c.name || !c.name.trim()) && c.email)
console.log(`\nediting ${target.email}:`)
const before = { name: target.name, manual_fields: target.manual_fields }
try {
  const w = await rest(`contacts?id=eq.${target.id}&select=name,manual_fields`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: 'PROBE Name', manual_fields: ['name'] }),
  })
  const row = (w.body ?? [])[0]
  check('a name can be set', row?.name === 'PROBE Name')
  check("and the field is recorded as a person's decision", (row?.manual_fields ?? []).includes('name'))
  // The guard the AI paths now use: update ... .is('name', null) AND not manual. Simulate both halves.
  const aiWouldWrite = await rest(`contacts?id=eq.${target.id}&name=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'AI OVERWRITE' }) })
  check('the AI cannot overwrite a name that is set', (aiWouldWrite.body ?? []).length === 0)
  // And the harder case: she CLEARS it. Null name, but manual_fields says a person decided.
  await rest(`contacts?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ name: null, manual_fields: ['name'] }) })
  // The filter writeCapturedName actually builds: .is('name', null).not('manual_fields','cs','{name}')
  // My first attempt wrote `not.manual_fields=cs.{name}`; PostgREST spells it `manual_fields=not.cs.{name}`.
  const cleared = await rest(`contacts?id=eq.${target.id}&name=is.null&manual_fields=not.cs.%7Bname%7D&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'AI OVERWRITE' }) })
  check('nor a name she deliberately CLEARED — the case .is(name,null) alone gets wrong',
    (cleared.body ?? []).length === 0)
} finally {
  await rest(`contacts?id=eq.${target.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(before) })
  const [back] = (await rest(`contacts?id=eq.${target.id}&select=name,manual_fields`)).body ?? []
  const same = back.name === before.name && JSON.stringify(back.manual_fields ?? null) === JSON.stringify(before.manual_fields ?? null)
  console.log(`\n  ${same ? '✓' : '✗'} restored — name ${back.name === null ? 'null' : back.name}, manual_fields ${JSON.stringify(back.manual_fields)}`)
  if (!same) fail++
}
console.log(fail === 0 ? '\nPASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
