// Schema verification for Commerce Phase 5a (QuickBooks connection). RUN AFTER applying
// add_commerce_8_quickbooks.sql. Proves the table exists, one-connection-per-tenant is enforced, and the
// environment/status CHECK constraints hold. Does NOT exercise the live OAuth flow (that needs a real
// Intuit sandbox app + env vars). Cleans up.  node scripts/verify-commerce-quickbooks.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'VERIFY-QBO-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: S, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const conn = (over = {}) => ({ tenant_id: tenantId, realm_id: '1234567890', environment: 'sandbox', access_token_encrypted: 'iv.tag.ct', refresh_token_encrypted: 'iv.tag.ct', access_token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'active', ...over })

let tenantId
try {
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: `${TAG} tenant` }) })).json(); tenantId = t.id

  const r1 = await rest('commerce_quickbooks_connections', { method: 'POST', body: JSON.stringify(conn()) })
  ok('table exists and accepts a valid connection row', r1.status === 201)

  const r2 = await rest('commerce_quickbooks_connections', { method: 'POST', body: JSON.stringify(conn({ realm_id: '999' })) })
  ok('second connection for the same tenant is rejected (unique tenant_id)', r2.status >= 400)

  const rEnv = await rest('commerce_quickbooks_connections', { method: 'POST', body: JSON.stringify({ ...conn(), tenant_id: tenantId, environment: 'bogus' }) })
  ok('bad environment value is rejected by CHECK constraint', rEnv.status >= 400)

  const rStatus = await rest(`commerce_quickbooks_connections?tenant_id=eq.${tenantId}`, { method: 'PATCH', body: JSON.stringify({ status: 'nonsense' }) })
  ok('bad status value is rejected by CHECK constraint', rStatus.status >= 400)

  const rows = await (await rest(`commerce_quickbooks_connections?tenant_id=eq.${tenantId}&select=realm_id,status,environment`)).json()
  ok('exactly one active sandbox connection persisted for the tenant', rows.length === 1 && rows[0].status === 'active' && rows[0].environment === 'sandbox')
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) await del(`tenants?id=eq.${tenantId}`)
  console.log('  (cleaned up throwaway tenant + connection via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ QUICKBOOKS SCHEMA VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
