import { createAdminClient } from '@/lib/supabase/server'

// Generic workflow engine. Verticals CONFIGURE stage sets + allowed edges; the Core validates and records
// transitions atomically (core_workflow_transition RPC). Tenant-scoped.
const admin = () => createAdminClient()

// Pure allowed-edge check (mirrors the RPC) — unit-tested.
export interface Edge { from: string | null; to: string }
export function isTransitionAllowed(currentKey: string | null, toKey: string, edges: Edge[]): boolean {
  return edges.some((e) => e.to === toKey && (e.from === currentKey || (e.from === null && currentKey === null)))
}

export interface StageInput { key: string; label: string; isInitial?: boolean; isTerminal?: boolean; isSuccess?: boolean; isFailed?: boolean }
export interface WorkflowInput { key: string; name: string; recordType: string; stages: StageInput[]; transitions: { from: string | null; to: string }[] }

// Install a workflow definition with its stages + allowed transitions (transition keys → stage ids).
export async function createWorkflow(tenantId: string, input: WorkflowInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: def, error } = await admin().from('workflow_definitions').insert({ tenant_id: tenantId, key: input.key, name: input.name, record_type: input.recordType }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const defId = def.id as string
  const { data: stageRows, error: sErr } = await admin().from('workflow_stages').insert(input.stages.map((s, i) => ({
    tenant_id: tenantId, workflow_definition_id: defId, key: s.key, label: s.label, sort_order: i,
    is_initial: !!s.isInitial, is_terminal: !!s.isTerminal, is_success: !!s.isSuccess, is_failed: !!s.isFailed,
  }))).select('id, key')
  if (sErr) return { ok: false, error: sErr.message }
  const idByKey = new Map((stageRows as Array<{ id: string; key: string }>).map((r) => [r.key, r.id]))
  const edges = input.transitions.map((t) => ({ tenant_id: tenantId, workflow_definition_id: defId, from_stage_id: t.from ? idByKey.get(t.from) ?? null : null, to_stage_id: idByKey.get(t.to)! })).filter((e) => e.to_stage_id)
  if (edges.length) { const { error: tErr } = await admin().from('workflow_transitions').insert(edges); if (tErr) return { ok: false, error: tErr.message } }
  return { ok: true, id: defId }
}

// Start (or return existing) a workflow instance for a record, at the initial stage.
export async function startInstance(tenantId: string, workflowDefinitionId: string, recordType: string, recordId: string): Promise<{ ok: true; instanceId: string } | { ok: false; error: string }> {
  const { data: initial } = await admin().from('workflow_stages').select('id').eq('tenant_id', tenantId).eq('workflow_definition_id', workflowDefinitionId).eq('is_initial', true).order('sort_order').limit(1).maybeSingle()
  const { data, error } = await admin().from('workflow_instances').upsert(
    { tenant_id: tenantId, workflow_definition_id: workflowDefinitionId, record_type: recordType, record_id: recordId, current_stage_id: initial?.id ?? null },
    { onConflict: 'tenant_id,workflow_definition_id,record_type,record_id', ignoreDuplicates: false },
  ).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, instanceId: data.id as string }
}

export async function transition(tenantId: string, instanceId: string, toStageId: string, actor: string, note?: string) {
  const { data, error } = await admin().rpc('core_workflow_transition', { p_tenant: tenantId, p_instance: instanceId, p_to_stage: toStageId, p_actor: actor, p_note: note ?? null })
  if (error) return { ok: false as const, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as { ok: boolean; error?: string; from?: string; to?: string; terminal?: boolean }
}

export async function getInstance(tenantId: string, instanceId: string) {
  const [{ data: inst }, { data: history }] = await Promise.all([
    admin().from('workflow_instances').select('*').eq('tenant_id', tenantId).eq('id', instanceId).maybeSingle(),
    admin().from('workflow_stage_history').select('*').eq('tenant_id', tenantId).eq('instance_id', instanceId).order('created_at', { ascending: false }),
  ])
  return inst ? { instance: inst, history: history ?? [] } : null
}
