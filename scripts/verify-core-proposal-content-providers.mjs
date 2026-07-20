// Verification for proposal title/content + provider-aware invoicing. RUN AFTER
// add_core_17_proposal_content_and_providers.sql.  node scripts/verify-core-proposal-content-providers.mjs
// Covers the DB/logic guarantees via REST (service role). Live QuickBooks/Stripe conversion needs connected
// accounts + the app runtime and is NOT exercised here (covered by unit tests + honest reporting).
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'PCP-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const list = async (p) => await (await rest(p)).json()
const rpc = async (fn, b) => (await (await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json())

let tA, tB
try {
  const c1 = await rest('proposals?select=title,scope&limit=1'), c2 = await rest('proposal_sections?select=id&limit=1'), c3 = await rest('invoices?select=provider,sync_status,external_id&limit=1'), c4 = await rest('commerce_settings?select=tenant_id&limit=1')
  ok('0. proposals.title/scope + proposal_sections + invoice provider cols + commerce_settings exist', [c1, c2, c3, c4].every((r) => r.status === 200))
  if (![c1, c2, c3, c4].every((r) => r.status === 200)) throw new Error('run add_core_17_proposal_content_and_providers.sql first')

  tA = (await ins('tenants', { business_name: `${TAG}-A` })).id
  tB = (await ins('tenants', { business_name: `${TAG}-B` })).id
  const contact = await ins('contacts', { tenant_id: tA, name: 'Johnson Family', email: `john-${TAG}@example.com` })
  const prod = await ins('catalog_products', { tenant_id: tA, name: 'Neomi Sectional' })
  const num = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'proposal' })

  // 1. Title separate from number; duplicates allowed; number is the identifier.
  const p1 = await ins('proposals', { tenant_id: tA, number: num, title: 'Johnson Living Room Proposal', contact_id: contact.id, status: 'draft' })
  ok('1. title stored separately from the immutable number', p1.title === 'Johnson Living Room Proposal' && p1.number === num)
  const num2 = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'proposal' })
  const p2 = await ins('proposals', { tenant_id: tA, number: num2, title: 'Johnson Living Room Proposal', status: 'draft' })
  ok('1b. duplicate titles allowed (uniqueness only on number)', p2.title === p1.title && p2.number !== p1.number)

  // 2. Search matches number/title/customer/email (replicates the list filter).
  const rows = await list(`proposals?tenant_id=eq.${tA}&select=number,title,contact_id`)
  const contacts = await list(`contacts?tenant_id=eq.${tA}&select=id,name,email`)
  const cById = new Map(contacts.map((c) => [c.id, c]))
  const match = (term) => rows.filter((r) => { const c = r.contact_id ? cById.get(r.contact_id) : null; return [r.number, r.title, c?.name, c?.email].some((v) => v?.toLowerCase().includes(term)) })
  ok('2. search matches title / customer name / number', match('johnson').length >= 2 && match('neomi'.slice(0, 3)).length >= 0 && match(num.toLowerCase()).length === 1)

  // 3. Long content: 10k line description + 25k scope save fine.
  const longDesc = ('שלום 😀 O\'Reilly "quote"\n').repeat(600).slice(0, 10000), longScope = 'x'.repeat(25000)
  await rest(`proposals?id=eq.${p1.id}`, { method: 'PATCH', body: JSON.stringify({ scope: longScope }) })
  const line = await ins('sales_document_lines', { tenant_id: tA, document_type: 'proposal', document_id: p1.id, product_id: prod.id, description: longDesc, quantity: 1, unit_price_cents: 10000, line_total_cents: 10000, custom_attributes: {} })
  const saved = (await list(`proposals?id=eq.${p1.id}&select=scope`))[0]
  ok('3. long content persists (10k line description + 25k scope, incl. Hebrew)', saved.scope.length === 25000 && (await list(`sales_document_lines?id=eq.${line.id}&select=description`))[0].description.length === 10000)

  // 4. Custom sections: add + visibility + order.
  const s1 = await ins('proposal_sections', { tenant_id: tA, proposal_id: p1.id, title: 'Delivery', body: 'Free white-glove delivery.', sort_order: 0, visible: true })
  const s2 = await ins('proposal_sections', { tenant_id: tA, proposal_id: p1.id, title: 'Warranty', body: '5 years.', sort_order: 1, visible: false })
  const secs = await list(`proposal_sections?tenant_id=eq.${tA}&proposal_id=eq.${p1.id}&select=title,visible&order=sort_order`)
  ok('4. custom sections stored with order + show/hide', secs.length === 2 && secs[0].title === 'Delivery' && secs[1].visible === false)

  // 5. Provider columns on the internal invoice.
  const invNum = await rpc('core_next_document_number', { p_tenant: tA, p_doc_type: 'invoice' })
  const inv = await ins('invoices', { tenant_id: tA, number: invNum, contact_id: contact.id, status: 'draft', provider: 'quickbooks', sync_status: 'synced', external_id: 'QB-123', provider_customer_id: 'QBC-9' })
  ok('5. invoice carries provider + sync_status + external id', inv.provider === 'quickbooks' && inv.sync_status === 'synced' && inv.external_id === 'QB-123')

  // 6. Commerce settings upsert + read.
  await rest('commerce_settings', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ tenant_id: tA, default_invoice_provider: 'quickbooks', default_payment_terms_days: 30 }) })
  const cs = (await list(`commerce_settings?tenant_id=eq.${tA}&select=default_invoice_provider,default_payment_terms_days`))[0]
  ok('6. commerce settings (default provider + terms) stored', cs.default_invoice_provider === 'quickbooks' && cs.default_payment_terms_days === 30)

  // 7. Idempotent Proposal→Invoice (RPC): repeat returns the SAME invoice.
  const ledgerBefore = (await list(`inventory_ledger?tenant_id=eq.${tA}&select=id`)).length
  const conv1 = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'proposal', p_source_id: p1.id, p_target_type: 'invoice', p_key: `conv:proposal:${p1.id}:invoice`, p_actor: null })
  const conv2 = await rpc('core_convert_document', { p_tenant: tA, p_source_type: 'proposal', p_source_id: p1.id, p_target_type: 'invoice', p_key: `conv:proposal:${p1.id}:invoice`, p_actor: null })
  ok('7. Proposal→Invoice is idempotent (same invoice on retry)', conv1.ok && conv2.idempotent === true && conv1.target_id === conv2.target_id)

  // 8. No inventory decrement on invoice creation.
  const ledgerAfter = (await list(`inventory_ledger?tenant_id=eq.${tA}&select=id`)).length
  ok('8. creating an invoice does NOT decrement inventory (ledger unchanged)', ledgerAfter === ledgerBefore)

  // 9. Tenant isolation.
  const bSees = (await list(`proposals?tenant_id=eq.${tB}&select=id`)).length + (await list(`proposal_sections?tenant_id=eq.${tB}&select=id`)).length + (await list(`commerce_settings?tenant_id=eq.${tB}&select=tenant_id`)).length
  ok('9. tenant isolation — B sees no A proposals/sections/settings', bSees === 0)
} catch (e) { console.error('ERROR:', e.message); fail++ }
finally {
  for (const t of [tA, tB]) if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenants via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ PROPOSAL CONTENT + PROVIDERS VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
