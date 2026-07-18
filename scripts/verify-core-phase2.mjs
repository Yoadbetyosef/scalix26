// Integration verification for Scalix Core Phase 2 (shared customer layer). RUN AFTER applying
// add_core_2_customer_layer.sql.  node scripts/verify-core-phase2.mjs
// Proves: new tables exist; tenant-scoped reads don't cross tenants; archive keeps the row; duplicate
// detection query works; core_merge_contacts atomically repoints linked records, is idempotent, rejects
// cross-tenant; channel-identity resolve works. Cleans up.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP2-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())
const one = async (p) => (await (await rest(p)).json())[0]

let tA, tB
try {
  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id

  // tables exist
  for (const t of ['companies', 'contact_companies', 'activities', 'files', 'channel_identities']) {
    const r = await rest(`${t}?select=id&limit=1`); ok(`table ${t} exists`, r.status === 200)
  }

  // winner + loser in A (dedupe candidates: same normalized phone)
  const winner = await ins('contacts', { tenant_id: tA, name: 'Ari', phone: '+1 415 555 2671', normalized_phone: '+14155552671', normalized_email: 'ari@x.com', email: 'ari@x.com' })
  const loser = await ins('contacts', { tenant_id: tA, name: 'Ari S', phone: '(415) 555-2671', normalized_phone: '+14155552671' })
  // tenant B contact with the SAME phone — must never appear in A's dedupe
  const bContact = await ins('contacts', { tenant_id: tB, name: 'Other', normalized_phone: '+14155552671' })

  // isolation: A-scoped query by normalized_phone returns only A's rows
  const dupRows = await one(`contacts?tenant_id=eq.${tA}&normalized_phone=eq.${encodeURIComponent('+14155552671')}&select=id`) ? await (await rest(`contacts?tenant_id=eq.${tA}&normalized_phone=eq.${encodeURIComponent('+14155552671')}&select=id`)).json() : []
  ok('dedupe query is tenant-scoped (finds A dups, excludes B)', dupRows.length === 2 && !dupRows.find((r) => r.id === bContact.id))

  // link loser to a company + add activity + identity + lead (things the merge must repoint)
  const company = await ins('companies', { tenant_id: tA, name: `${TAG} Co` })
  await ins('contact_companies', { tenant_id: tA, contact_id: loser.id, company_id: company.id })
  await ins('activities', { tenant_id: tA, contact_id: loser.id, type: 'note', body: 'on loser' })
  await ins('channel_identities', { tenant_id: tA, contact_id: loser.id, channel: 'sms', external_id: '+14155552671' })
  await ins('leads', { tenant_id: tA, contact_id: loser.id, source: 'other', status: 'new', phone: '+14155552671' })

  // archive keeps the row
  await rest(`contacts?id=eq.${loser.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: new Date().toISOString() }) })
  ok('archived contact still present (history preserved)', !!(await one(`contacts?id=eq.${loser.id}&select=id,archived_at`)))
  await rest(`contacts?id=eq.${loser.id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: null }) })

  // MERGE loser → winner
  const m = await rpc('core_merge_contacts', { p_tenant: tA, p_winner: winner.id, p_loser: loser.id, p_actor: null })
  ok('merge ok, reports moved counts', m.ok === true && m.moved && m.moved.activities >= 1)
  ok('activity repointed to winner', (await (await rest(`activities?tenant_id=eq.${tA}&contact_id=eq.${winner.id}&type=eq.note&select=id`)).json()).length >= 1)
  ok('identity repointed to winner', !!(await one(`channel_identities?tenant_id=eq.${tA}&contact_id=eq.${winner.id}&channel=eq.sms&select=id`)))
  ok('company link repointed to winner', !!(await one(`contact_companies?tenant_id=eq.${tA}&contact_id=eq.${winner.id}&company_id=eq.${company.id}&select=id`)))
  ok('lead repointed to winner', !!(await one(`leads?tenant_id=eq.${tA}&contact_id=eq.${winner.id}&select=id`)))
  const loserRow = await one(`contacts?id=eq.${loser.id}&select=merged_into_id,archived_at`)
  ok('loser marked merged_into winner + archived', loserRow.merged_into_id === winner.id && !!loserRow.archived_at)
  ok('merge recorded a merge activity', !!(await one(`activities?tenant_id=eq.${tA}&contact_id=eq.${winner.id}&type=eq.merge&select=id`)))

  // idempotent
  const m2 = await rpc('core_merge_contacts', { p_tenant: tA, p_winner: winner.id, p_loser: loser.id, p_actor: null })
  ok('repeat merge is idempotent (no error, no duplicate)', m2.ok === true && m2.idempotent === true)

  // cross-tenant merge rejected
  const mX = await rpc('core_merge_contacts', { p_tenant: tA, p_winner: winner.id, p_loser: bContact.id, p_actor: null })
  ok('cross-tenant merge rejected (loser not in tenant)', mX.ok === false && mX.error === 'loser_not_found')

  // channel identity resolve
  ok('resolve contact by identity returns the winner', (await one(`channel_identities?tenant_id=eq.${tA}&channel=eq.sms&external_id=eq.${encodeURIComponent('+14155552671')}&select=contact_id`))?.contact_id === winner.id)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 2 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
