// Integration verification for Scalix Core Phase 6 (workflow). RUN AFTER applying add_core_6_workflow.sql.
//   node scripts/verify-core-phase6.mjs
// Proves: workflow defs/stages/transitions/instances/history; validated transition RPC allows defined edges,
// records history, sets terminal status, and REJECTS undefined edges + out-of-workflow stages. Cleans up.
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const TAG = 'COREP6-' + Date.now()
let pass = 0, fail = 0
const ok = (d, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}`); c ? pass++ : fail++ }
const rest = (p, o = {}) => fetch(`${U}/rest/v1/${p}`, { headers: H, ...o })
const ins = async (t, b) => (await (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json())
const one = async (t, b) => (await ins(t, b))[0]
const rpc = (fn, args) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json())
const list = async (p) => (await (await rest(p)).json())

let t
try {
  t = (await one('tenants', { business_name: TAG })).id
  for (const tbl of ['workflow_definitions', 'workflow_stages', 'workflow_transitions', 'workflow_instances', 'workflow_stage_history']) {
    ok(`table ${tbl} exists`, (await rest(`${tbl}?select=id&limit=1`)).status === 200)
  }

  const def = await one('workflow_definitions', { tenant_id: t, key: 'job', name: 'Job', record_type: 'order' })
  const stages = await ins('workflow_stages', [
    { tenant_id: t, workflow_definition_id: def.id, key: 'new', label: 'New', sort_order: 0, is_initial: true },
    { tenant_id: t, workflow_definition_id: def.id, key: 'in_progress', label: 'In progress', sort_order: 1 },
    { tenant_id: t, workflow_definition_id: def.id, key: 'done', label: 'Done', sort_order: 2, is_terminal: true, is_success: true },
  ])
  const id = Object.fromEntries(stages.map((s) => [s.key, s.id]))
  await ins('workflow_transitions', [
    { tenant_id: t, workflow_definition_id: def.id, from_stage_id: id.new, to_stage_id: id.in_progress },
    { tenant_id: t, workflow_definition_id: def.id, from_stage_id: id.in_progress, to_stage_id: id.done },
  ])
  const inst = await one('workflow_instances', { tenant_id: t, workflow_definition_id: def.id, record_type: 'order', record_id: crypto.randomUUID(), current_stage_id: id.new })

  const okMove = await rpc('core_workflow_transition', { p_tenant: t, p_instance: inst.id, p_to_stage: id.in_progress, p_actor: null, p_note: 'start' })
  ok('allowed transition new→in_progress succeeds', okMove.ok === true && okMove.to === id.in_progress)
  ok('transition recorded in history', (await list(`workflow_stage_history?tenant_id=eq.${t}&instance_id=eq.${inst.id}&select=id`)).length === 1)

  const illegal = await rpc('core_workflow_transition', { p_tenant: t, p_instance: inst.id, p_to_stage: id.new, p_actor: null, p_note: null })
  ok('undefined transition (in_progress→new) rejected', illegal.ok === false && illegal.error === 'transition_not_allowed')

  const done = await rpc('core_workflow_transition', { p_tenant: t, p_instance: inst.id, p_to_stage: id.done, p_actor: null, p_note: 'ship' })
  ok('transition to terminal success stage marks instance completed', done.ok === true && (await list(`workflow_instances?id=eq.${inst.id}&select=status`))[0].status === 'completed')

  // a stage from ANOTHER workflow must be rejected
  const def2 = await one('workflow_definitions', { tenant_id: t, key: 'other', name: 'Other', record_type: 'order' })
  const stg2 = await one('workflow_stages', { tenant_id: t, workflow_definition_id: def2.id, key: 'x', label: 'X' })
  const wrong = await rpc('core_workflow_transition', { p_tenant: t, p_instance: inst.id, p_to_stage: stg2.id, p_actor: null, p_note: null })
  ok('stage from another workflow rejected', wrong.ok === false && wrong.error === 'stage_not_in_workflow')
} catch (e) {
  console.error('ERROR:', e.message); fail++
} finally {
  if (t) await rest(`tenants?id=eq.${t}`, { method: 'DELETE' })
  console.log('  (cleaned up throwaway tenant via CASCADE)')
}
console.log(`\n${fail === 0 ? '✅ CORE PHASE 6 VERIFIED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
