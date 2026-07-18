// Integration verification for Scalix Core Phase 7 (configuration). RUN AFTER applying
// add_core_7_configuration.sql (and phases 3-4).  node scripts/verify-core-phase7.mjs
// Proves: terminology_overrides stored + unique; numbering is CONFIGURABLE (custom prefix flows into the
// generated document number); dropdown options add + deactivate. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP7-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const one = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())[0]
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())
const list = async (p) => (await (await rest(p)).json())

let t
try {
  t = (await one('tenants', { business_name: TAG })).id
  ok('table terminology_overrides exists', (await rest('terminology_overrides?select=id&limit=1')).status === 200)

  // terminology override + unique
  const ov = await rest('terminology_overrides', { method: 'POST', body: JSON.stringify({ tenant_id: t, noun_key: 'order', singular: 'Memo', plural: 'Memos' }) })
  ok('terminology override stored', ov.status === 201)
  const dup = await rest('terminology_overrides', { method: 'POST', body: JSON.stringify({ tenant_id: t, noun_key: 'order', singular: 'X' }) })
  ok('duplicate (tenant, noun) rejected (unique)', dup.status >= 400)

  // CONFIGURABLE numbering: set a custom prefix, then the generated number uses it
  await rest('numbering_counters', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ tenant_id: t, doc_type: 'order', prefix: 'MEMO-', padding: 5, next_number: 1 }) })
  const num = await rpc('core_next_document_number', { p_tenant: t, p_doc_type: 'order' })
  ok('generated number honors the configured prefix + padding', num === 'MEMO-00001')

  // dropdown options add + deactivate
  const def = await one('field_definitions', { tenant_id: t, entity_type: 'product', key: 'fabric', label: 'Fabric', field_type: 'select' })
  const opt = await one('field_options', { tenant_id: t, field_definition_id: def.id, value: 'velvet', label: 'Velvet' })
  ok('dropdown option added', !!opt?.id)
  await rest(`field_options?id=eq.${opt.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) })
  ok('option can be deactivated (kept, not deleted)', (await list(`field_options?id=eq.${opt.id}&select=active`))[0].active === false)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenant via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 7 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
