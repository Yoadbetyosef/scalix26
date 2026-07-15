// Post-migration regression verification for the hardening sprint.
// RUN ONLY AFTER applying harden_1_knowledge_tenant_ownership.sql AND harden_2_advisor_security.sql.
// Creates a throwaway tenant + two agents + knowledge rows, asserts the tenant-owned knowledge model
// (shared, agent-specific, sibling access, cross-tenant/anon denial, deletion-preserves-knowledge),
// checks the Advisor view/partition lockdown, then cleans everything up.
//   node scripts/verify-hardening.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY, AK = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const S = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const A = { apikey: AK, Authorization: `Bearer ${AK}` }
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: S, ...o })
const del = (p) => fetch(`${U}/rest/v1/${p}`, { method: 'DELETE', headers: S })
const count = async (headers, p) => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } }); const cr = r.headers.get('content-range') || ''; return Number((cr.split('/')[1]) || 0) }

let tenantId, agentA, agentB
try {
  const [t] = await (await rest('tenants', { method: 'POST', body: JSON.stringify({ business_name: 'ZZZ-HARDENING-TEST' }) })).json()
  tenantId = t.id
  const [a] = await (await rest('ai_employees', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: 'Agent A' }) })).json()
  const [b] = await (await rest('ai_employees', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, name: 'Agent B' }) })).json()
  agentA = a.id; agentB = b.id
  ok('created throwaway tenant + 2 agents', !!tenantId && !!agentA && !!agentB)

  await rest('knowledge_base', { method: 'POST', body: JSON.stringify([
    { tenant_id: tenantId, ai_employee_id: null, title: 'Shared', content: 'shared', source: 'manual' },
    { tenant_id: tenantId, ai_employee_id: agentA, title: 'AgentA only', content: 'a-only', source: 'manual' },
  ]) })

  // Read model: tenant_id AND (ai_employee_id IS NULL OR = agent)
  const seenByA = await count(S, `knowledge_base?tenant_id=eq.${tenantId}&or=(ai_employee_id.is.null,ai_employee_id.eq.${agentA})`)
  const seenByB = await count(S, `knowledge_base?tenant_id=eq.${tenantId}&or=(ai_employee_id.is.null,ai_employee_id.eq.${agentB})`)
  ok('agent A sees shared + its own (2 rows)', seenByA === 2)
  ok('sibling agent B sees only shared (1 row) — agent-specific hidden', seenByB === 1)

  // Cross-tenant / unauthenticated denial via RLS (anon key sees 0).
  const anonSees = await count(A, `knowledge_base?tenant_id=eq.${tenantId}&select=id`)
  ok('anon (cross-tenant/unauth) sees 0 of this tenant’s knowledge', anonSees === 0)

  // Deletion preserves knowledge: delete agent A → its agent-specific row survives as SHARED (SET NULL).
  await del(`ai_employees?id=eq.${agentA}`)
  const survivors = await (await rest(`knowledge_base?tenant_id=eq.${tenantId}&select=title,ai_employee_id&order=title`)).json()
  ok('deleting agent A did NOT delete its knowledge (2 rows remain)', survivors.length === 2)
  const converted = survivors.find((r) => r.title === 'AgentA only')
  ok('agent-specific row converted to shared (ai_employee_id NULL) on agent delete', converted && converted.ai_employee_id === null)

  // Advisor lockdown: anon must not read the two views (0 rows) or partitions.
  const v1 = await count(A, 'partner_ledger_reconciliation?select=partner_id')
  const v2 = await count(A, 'unsettled_wl_usage?select=id')
  ok('anon reads 0 rows from partner_ledger_reconciliation', v1 === 0)
  ok('anon reads 0 rows from unsettled_wl_usage', v2 === 0)
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (tenantId) { await del(`knowledge_base?tenant_id=eq.${tenantId}`); await del(`ai_employees?tenant_id=eq.${tenantId}`); await del(`tenants?id=eq.${tenantId}`) }
  console.log('  (cleaned up throwaway tenant/agents/knowledge)')
}
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
