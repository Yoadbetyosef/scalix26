// Which orders have no customer record, and which of them can be linked without guessing.
//
//   node scripts/audit-order-contacts.mjs [tenant-id] [--apply]
//
// Reads every unlinked order for the tenant (default: TG) and classifies it:
//
//   SAFE AUTO-LINK  exactly one live contact shares the order's normalised email; or, with no email
//                   match at all, exactly one shares the last ten digits of its phone
//   AMBIGUOUS       two or more contacts match — a person must choose; OR the only match is the
//                   business's OWN address (or the platform admin's), typed as a placeholder on
//                   somebody else's order — linking "Andrea's ring" to Tatiana's own contact record
//                   would be wrong, however exact the email match
//   NO MATCH        nothing matches — no contact is invented from free text
//
// Never by name. With --apply, only SAFE AUTO-LINK rows get contact_id set (nothing else on the
// order changes) and an order_events row records the link. The same rule is part 9 of
// add_tg_production_1.sql, so a rebuilt environment converges on the same answer.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantId = args.find((a) => !a.startsWith('--')) || 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'

const normEmail = (v) => { const t = (v ?? '').trim().toLowerCase(); return t.includes('@') ? t : null }
const normPhone = (v) => { const d = (v ?? '').replace(/\D/g, ''); return d.length < 7 ? null : d.slice(-10) }

// Addresses that identify the BUSINESS, not a customer: the tenant's email, its agents' and
// letterhead emails, their domains, and the platform admins. A match on one of these is a
// placeholder, not a person.
const [tenant] = await (await rest(`tenants?select=email&id=eq.${tenantId}`)).json()
const agents = await (await rest(`ai_employees?select=email,reply_from_email&tenant_id=eq.${tenantId}`)).json()
const profiles = await (await rest(`letterhead_profiles?select=email&tenant_id=eq.${tenantId}`)).json()
const ownEmails = new Set([tenant?.email, ...agents.flatMap((a) => [a.email, a.reply_from_email]), ...profiles.map((p) => p.email),
  ...(env.ADMIN_EMAILS ?? '').split(',')].map((v) => (v ?? '').trim().toLowerCase()).filter((v) => v.includes('@')))
const ownDomains = new Set([...ownEmails].map((e) => e.split('@')[1]).filter((d) => d && !['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(d)))
const isOwn = (c) => { const e = normEmail(c.email); return !!e && (ownEmails.has(e) || ownDomains.has(e.split('@')[1])) }

const orders = await (await rest(`orders?select=id,order_number,customer_name,customer_company,customer_email,customer_phone,stage,created_at&tenant_id=eq.${tenantId}&contact_id=is.null&order=created_at.desc`)).json()
const contacts = await (await rest(`contacts?select=id,name,company_name,email,phone&tenant_id=eq.${tenantId}&merged_into_id=is.null&archived_at=is.null`)).json()

const byEmail = new Map(), byPhone = new Map()
for (const c of contacts) {
  const e = normEmail(c.email); if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), c])
  const p = normPhone(c.phone); if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), c])
}

const rows = orders.map((o) => {
  const e = normEmail(o.customer_email), p = normPhone(o.customer_phone)
  const em = e ? (byEmail.get(e) ?? []) : []
  const pm = p ? (byPhone.get(p) ?? []) : []
  let verdict, via = null, contact = null, candidates = [], note = null
  if (em.length === 1 && isOwn(em[0])) { verdict = 'AMBIGUOUS'; via = 'email'; candidates = em; note = 'matches the business\'s own address — a placeholder, not the customer' }
  else if (em.length === 1) { verdict = 'SAFE AUTO-LINK'; via = 'email'; contact = em[0] }
  else if (em.length > 1) { verdict = 'AMBIGUOUS'; via = 'email'; candidates = em }
  else if (pm.length === 1 && isOwn(pm[0])) { verdict = 'AMBIGUOUS'; via = 'phone'; candidates = pm; note = 'matches the business\'s own number' }
  else if (pm.length === 1) { verdict = 'SAFE AUTO-LINK'; via = 'phone'; contact = pm[0] }
  else if (pm.length > 1) { verdict = 'AMBIGUOUS'; via = 'phone'; candidates = pm }
  else verdict = 'NO MATCH'
  return { o, verdict, via, contact, candidates, note }
})

const label = (c) => [c.company_name, c.name].filter(Boolean).join(' — ') || c.email || c.phone || c.id
console.log(`Tenant ${tenantId.slice(0, 8)}… — ${orders.length} unlinked order(s), ${contacts.length} live contact(s)\n`)
for (const v of ['SAFE AUTO-LINK', 'AMBIGUOUS', 'NO MATCH']) {
  const group = rows.filter((r) => r.verdict === v)
  console.log(`${v} (${group.length})`)
  for (const r of group) {
    const who = [r.o.customer_company, r.o.customer_name].filter(Boolean).join(' — ') || '(no name)'
    const ident = [r.o.customer_email, r.o.customer_phone].filter(Boolean).join(' / ') || '(no email, no phone)'
    const extra = r.contact ? `→ ${label(r.contact)} (by ${r.via})`
      : r.candidates.length ? `→ ${r.candidates.length} candidate(s) by ${r.via}: ${r.candidates.map(label).join(' | ')}${r.note ? ` — ${r.note}` : ''}` : ''
    console.log(`  ${r.o.order_number.padEnd(14)} ${r.o.stage.padEnd(16)} ${who} · ${ident} ${extra}`)
  }
  console.log()
}

if (!apply) { console.log('Dry run. Re-run with --apply to link the SAFE AUTO-LINK rows only.'); process.exit(0) }

let linked = 0
for (const r of rows.filter((x) => x.verdict === 'SAFE AUTO-LINK')) {
  const res = await rest(`orders?id=eq.${r.o.id}&contact_id=is.null`, { method: 'PATCH', body: JSON.stringify({ contact_id: r.contact.id }) })
  if (!res.ok) { console.error('failed', r.o.order_number, await res.text()); continue }
  await rest('order_events', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, order_id: r.o.id, type: 'contact_linked', actor: 'system', payload: { contactId: r.contact.id, created: false, via: r.via, by: 'audit-order-contacts' } }) })
  linked++
}
console.log(`Linked ${linked} order(s). Ambiguous and unmatched orders were not touched.`)
