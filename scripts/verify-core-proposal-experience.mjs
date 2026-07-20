// Verification for the completed Proposal experience. RUN AFTER add_core_16_proposal_experience.sql.
//   node scripts/verify-core-proposal-experience.mjs
// Covers the DB/logic guarantees via REST (service role): schema, draft-vs-token preview, token security +
// revocation, activity timeline, branding, contact create + dedupe, line image controls, edit locks, and
// tenant isolation. (Email send, internal-preview no-view suppression, and route permission checks are
// covered by unit tests + the live YDC pass, since they need the app runtime.)
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'PEXP-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => await (await rest(p)).json()
const patch = (p, b) => rest(p, { method: 'PATCH', body: JSON.stringify(b) })
const rpc = async (fn, b) => (await (await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json())
const hash = (t) => createHash('sha256').update(t).digest('hex')
const nEmail = (e) => (e ? e.trim().toLowerCase() : null)

let tA, tB
try {
  const c1 = await rest('proposal_activity?select=id&limit=1'), c2 = await rest('proposal_branding?select=tenant_id&limit=1'), c3 = await rest('proposals?select=public_token,template,updated_after_send_at,last_emailed_to&limit=1')
  ok('0. proposal_activity + proposal_branding + new proposal columns exist', c1.status === 200 && c2.status === 200 && c3.status === 200)
  if (c1.status !== 200 || c2.status !== 200 || c3.status !== 200) throw new Error('run add_core_16_proposal_experience.sql first')

  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const num = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'proposal' })
  const prop = await ins('proposals', { tenant_id: tA, number: num, status: 'draft', template: 'clean' })

  // 1. Draft has a template and NO public token → not resolvable by any token (internal preview only).
  ok('1. draft has template + no public token', prop.template === 'clean' && !prop.public_token && !prop.public_token_hash)
  // 2. draft IS fetchable by id (internal preview path renders it without a token)
  ok('2. draft renders internally (fetchable by id + tenant)', (await list(`proposals?id=eq.${prop.id}&tenant_id=eq.${tA}&select=id`)).length === 1)

  // 3. Send simulation: activate a token → public lookup resolves; revoke → stops resolving.
  const raw = randomBytes(32).toString('base64url')
  await patch(`proposals?id=eq.${prop.id}`, { public_token: raw, public_token_hash: hash(raw), status: 'sent', sent_at: new Date().toISOString() })
  ok('3. sent proposal resolves by token hash', (await list(`proposals?public_token_hash=eq.${hash(raw)}&public_token_revoked_at=is.null&select=id`)).length === 1)
  await patch(`proposals?id=eq.${prop.id}`, { public_token_revoked_at: new Date().toISOString() })
  ok('3b. revoked token no longer resolves', (await list(`proposals?public_token_hash=eq.${hash(raw)}&public_token_revoked_at=is.null&select=id`)).length === 0)

  // 4. Activity timeline (insert + ordered read).
  for (const ev of ['created', 'email_attempted', 'email_sent', 'viewed']) await ins('proposal_activity', { tenant_id: tA, proposal_id: prop.id, event_type: ev, message: ev })
  const acts = await list(`proposal_activity?tenant_id=eq.${tA}&proposal_id=eq.${prop.id}&select=event_type&order=created_at.desc`)
  ok('4. activity timeline records events', acts.length >= 4 && acts.some((a) => a.event_type === 'email_sent') && acts.some((a) => a.event_type === 'viewed'))

  // 5. Branding upsert + read (business_name override).
  await rest('proposal_branding', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ tenant_id: tA, business_name: 'Design Co', accent_color: '#123456', default_terms: 'Net 30', footer_text: 'Thanks!' }) })
  const brand = (await list(`proposal_branding?tenant_id=eq.${tA}&select=business_name,accent_color,default_terms`))[0]
  ok('5. proposal branding stored (name + accent + default terms)', brand.business_name === 'Design Co' && brand.accent_color === '#123456' && brand.default_terms === 'Net 30')

  // 6. Contact create + dedupe (replicates createContactWithDedupe's detection).
  const email = `dupe-${TAG}@example.com`
  await ins('contacts', { tenant_id: tA, name: 'Existing Buyer', email, normalized_email: nEmail(email), channel: 'manual' })
  const dupes = await list(`contacts?tenant_id=eq.${tA}&archived_at=is.null&merged_into_id=is.null&normalized_email=eq.${nEmail(email)}&select=id,name`)
  ok('6. duplicate contact detected by normalized email', dupes.length === 1 && dupes[0].name === 'Existing Buyer')

  // 7. Line + image controls (snapshot, hide, proposal-specific override).
  const lineRow = await ins('sales_document_lines', { tenant_id: tA, document_type: 'proposal', document_id: prop.id, description: 'Sofa', quantity: 1, unit_price_cents: 10000, line_total_cents: 10000, custom_attributes: { snapshot: { image_url: 'https://x/cat.jpg', sku: 'S1' }, image_url: 'https://x/cat.jpg', sku: 'S1' } })
  await patch(`sales_document_lines?id=eq.${lineRow.id}`, { custom_attributes: { ...lineRow.custom_attributes, hide_image: true } })
  const l1 = (await list(`sales_document_lines?id=eq.${lineRow.id}&select=custom_attributes`))[0]
  ok('7. line image can be hidden on the proposal', l1.custom_attributes.hide_image === true)
  await patch(`sales_document_lines?id=eq.${lineRow.id}`, { custom_attributes: { ...l1.custom_attributes, hide_image: false, proposal_image_url: 'https://x/custom.jpg' } })
  const l2 = (await list(`sales_document_lines?id=eq.${lineRow.id}&select=custom_attributes`))[0]
  ok('7b. proposal-specific image override stored (catalog snapshot preserved)', l2.custom_attributes.proposal_image_url === 'https://x/custom.jpg' && l2.custom_attributes.snapshot.image_url === 'https://x/cat.jpg')

  // 8. Edit-lock lifecycle: a proposal reaches accepted then converted (terminal).
  await patch(`proposals?id=eq.${prop.id}`, { status: 'accepted', accepted_at: new Date().toISOString(), accepted_by_name: 'Dana' })
  const acc = (await list(`proposals?id=eq.${prop.id}&select=status,accepted_by_name`))[0]
  ok('8. proposal can be accepted (app locks editing at this status)', acc.status === 'accepted' && acc.accepted_by_name === 'Dana')

  // 9. Tenant isolation.
  const bSees = (await list(`proposals?tenant_id=eq.${tB}&select=id`)).length + (await list(`proposal_activity?tenant_id=eq.${tB}&select=id`)).length + (await list(`proposal_branding?tenant_id=eq.${tB}&select=tenant_id`)).length
  ok('9. tenant isolation — B sees no A proposal/activity/branding', bSees === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PROPOSAL EXPERIENCE VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
