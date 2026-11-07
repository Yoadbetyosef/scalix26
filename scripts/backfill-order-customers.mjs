// Put every order's customer into the address book, and every detail typed on an order onto the
// customer's record.
//
//   node scripts/backfill-order-customers.mjs [tenant-id] [--apply]
//
// The repair for "a customer with an estimate is missing from Customers and I cannot find his phone".
// Three passes, dry run by default:
//
//   1. NORMALISE  contacts with a phone/email but no normalized_phone/normalized_email get one, so a
//                 search by the digits finds them (lib/contacts/page-read.ts searches normalized_phone)
//   2. LINK       an order with no contact_id is matched by email then phone (never by name); with no
//                 match, a contact is CREATED from what the order holds — the same rule new orders
//                 follow since lib/orders/link-contact.ts. The business's own email and phone, typed
//                 as placeholders on somebody else's order, are stripped first: they identify
//                 Tatiana, not her customer. An order left with nothing identifying (STOCK, her own
//                 test orders) is skipped and listed.
//   3. FILL       a linked contact's EMPTY name / company / email / phone is filled from its orders,
//                 newest first. A value already on the record is never replaced.
//
// Orders themselves are not changed except contact_id; each new link writes a contact_linked event.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (p, o = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })
  const body = await r.text()
  if (!r.ok) throw new Error(`${o.method ?? 'GET'} ${p} → ${r.status} ${body}`)
  return body ? JSON.parse(body) : null
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantId = args.find((a) => !a.startsWith('--')) || 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'

const normEmail = (v) => { const t = (v ?? '').trim().toLowerCase(); return t.includes('@') ? t : null }
const normPhone = (v) => { const d = (v ?? '').replace(/\D/g, ''); return d.length < 7 ? null : d.slice(-10) }
const blank = (v) => !String(v ?? '').trim()

// The business's own identifiers — a placeholder, never a customer.
const [tenant] = await rest(`tenants?select=email,phone,forward_to_phone&id=eq.${tenantId}`)
const agents = await rest(`ai_employees?select=email,phone&tenant_id=eq.${tenantId}`).catch(() => [])
const profiles = await rest(`letterhead_profiles?select=email,phone&tenant_id=eq.${tenantId}`).catch(() => [])
const ownEmails = new Set([tenant?.email, ...agents.map((a) => a.email), ...profiles.map((p) => p.email), ...(env.ADMIN_EMAILS ?? '').split(','), 'yoadbetyosef@gmail.com']
  .map(normEmail).filter(Boolean))
const ownDomains = new Set([...ownEmails].map((e) => e.split('@')[1]).filter((d) => !['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(d)))
const ownPhones = new Set([tenant?.phone, tenant?.forward_to_phone, ...agents.map((a) => a.phone), ...profiles.map((p) => p.phone), '9174954300'].map(normPhone).filter(Boolean))
const isOwnEmail = (e) => !!e && (ownEmails.has(e) || ownDomains.has(e.split('@')[1]))
// Not a customer at all: stock pieces and the owner's own test orders.
const NOT_A_CUSTOMER = /^(stock|test|tatiana getter)$/i

const now = new Date().toISOString()
const log = []

// 1. NORMALISE
const contacts = await rest(`contacts?select=id,name,company_name,email,phone,normalized_email,normalized_phone&tenant_id=eq.${tenantId}&merged_into_id=is.null&archived_at=is.null&limit=5000`)
for (const c of contacts) {
  const patch = {}
  if (c.phone && !c.normalized_phone && normPhone(c.phone)) patch.normalized_phone = normPhone(c.phone)
  if (c.email && !c.normalized_email && normEmail(c.email)) patch.normalized_email = normEmail(c.email)
  if (Object.keys(patch).length) {
    log.push(['NORMALISE', c.name || c.company_name || c.email || c.phone, JSON.stringify(patch)])
    Object.assign(c, patch)
    if (apply) await rest(`contacts?id=eq.${c.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  }
}
const byId = new Map(contacts.map((c) => [c.id, c]))
const byEmail = new Map(), byPhone = new Map()
const index = (c) => {
  const e = normEmail(c.email); if (e && !byEmail.has(e)) byEmail.set(e, c)
  const p = normPhone(c.phone); if (p && !byPhone.has(p)) byPhone.set(p, c)
}
contacts.forEach(index)

// 2. LINK
const createdByName = new Map()
const orders = await rest(`orders?select=id,order_number,contact_id,customer_name,customer_company,customer_email,customer_phone,created_at&tenant_id=eq.${tenantId}&order=created_at.desc`)
for (const o of orders.filter((x) => !x.contact_id)) {
  let email = normEmail(o.customer_email); if (isOwnEmail(email)) email = null
  let phone = normPhone(o.customer_phone); if (phone && ownPhones.has(phone)) phone = null
  const name = (o.customer_name ?? '').trim(), company = (o.customer_company ?? '').trim()
  // The platform admin's test orders carry the admin's own address: not a customer of hers.
  const adminTest = (env.ADMIN_EMAILS ?? 'yoadbetyosef@gmail.com').split(',').concat('yoadbetyosef@gmail.com').map(normEmail).includes(normEmail(o.customer_email))
  if (adminTest || NOT_A_CUSTOMER.test(name) || (!email && !phone && !name && !company)) {
    log.push(['SKIP', o.order_number, `${name || '(no name)'} — nothing that identifies a customer`])
    continue
  }
  // A name-only customer created earlier in THIS run is the same person (two orders typed for one
  // walk-in); a name never matches a contact that already existed — see link-contact.ts.
  let contact = (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || (!email && !phone && createdByName.get(`${name}|${company}`.toLowerCase())) || null
  let created = false
  if (!contact) {
    const row = {
      tenant_id: tenantId, name: name || null, company_name: company || null,
      email: email ? o.customer_email.trim() : null, phone: phone ? o.customer_phone.trim() : null,
      normalized_email: email, normalized_phone: phone, total_conversations: 0,
    }
    if (apply) [contact] = await rest('contacts', { method: 'POST', body: JSON.stringify(row) })
    else contact = { id: `(new for ${o.order_number})`, ...row }
    created = true
    createdByName.set(`${name}|${company}`.toLowerCase(), contact)
    contacts.push(contact); byId.set(contact.id, contact); index(contact)
  }
  log.push([created ? 'LINK+CREATE' : 'LINK', o.order_number, `${name || company || '(no name)'} → ${contact.name || contact.company_name || contact.email || contact.phone}`])
  o.contact_id = contact.id
  if (apply) {
    await rest(`orders?id=eq.${o.id}&tenant_id=eq.${tenantId}`, { method: 'PATCH', body: JSON.stringify({ contact_id: contact.id }) })
    await rest('order_events', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, order_id: o.id, type: 'contact_linked', actor: 'system', payload: { contactId: contact.id, created, backfill: true } }) })
      .catch(() => rest('order_events', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, order_id: o.id, type: 'contact_linked', actor: 'system' }) }))
  }
}

// 3. FILL — newest order first, so the most recent details win an empty field.
for (const o of orders.filter((x) => x.contact_id)) {
  const c = byId.get(o.contact_id)
  if (!c) continue
  const patch = {}
  const name = (o.customer_name ?? '').trim(), company = (o.customer_company ?? '').trim()
  const email = normEmail(o.customer_email), phone = normPhone(o.customer_phone)
  // A name that is only the company again adds nothing — the row already leads with the company.
  if (name && !NOT_A_CUSTOMER.test(name) && blank(c.name) && name.toLowerCase() !== (c.company_name ?? company).trim().toLowerCase()) patch.name = name
  if (company && blank(c.company_name)) patch.company_name = company
  if (email && !isOwnEmail(email) && blank(c.email)) { patch.email = o.customer_email.trim(); patch.normalized_email = email }
  if (phone && !ownPhones.has(phone) && blank(c.phone)) { patch.phone = o.customer_phone.trim(); patch.normalized_phone = phone }
  if (!Object.keys(patch).length) continue
  Object.assign(c, patch)
  log.push(['FILL', o.order_number, `${c.name || c.company_name || c.email} ← ${Object.entries(patch).filter(([k]) => !k.startsWith('normalized')).map(([k, v]) => `${k}=${v}`).join(', ')}`])
  if (apply && !String(c.id).startsWith('(new')) await rest(`contacts?id=eq.${c.id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, updated_at: now }) })
}

for (const r of log) console.log(r.join('  ·  '))
console.log(`\n${apply ? 'APPLIED' : 'DRY RUN (pass --apply to write)'} — ${log.filter((r) => r[0].startsWith('LINK')).length} linked, ${log.filter((r) => r[0] === 'LINK+CREATE').length} created, ${log.filter((r) => r[0] === 'FILL').length} filled, ${log.filter((r) => r[0] === 'NORMALISE').length} normalised, ${log.filter((r) => r[0] === 'SKIP').length} skipped`)
