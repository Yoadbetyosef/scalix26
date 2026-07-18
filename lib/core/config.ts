import { createAdminClient } from '@/lib/supabase/server'

// Configuration foundation: numbering rules + custom-field/dropdown admin. Customer admins may manage
// these; they may NOT touch financial formulas, the inventory ledger, or security (enforced by keeping
// those in code + RPCs, not config). Tenant-scoped.
const admin = () => createAdminClient()

// ── numbering rules (over the numbering_counters table) ──
export async function listNumberingRules(tenantId: string) {
  const { data } = await admin().from('numbering_counters').select('doc_type, prefix, padding, next_number').eq('tenant_id', tenantId).order('doc_type')
  return data ?? []
}
export async function updateNumberingRule(tenantId: string, docType: string, patch: { prefix?: string; padding?: number; nextNumber?: number }) {
  const row: Record<string, unknown> = { tenant_id: tenantId, doc_type: docType }
  if (patch.prefix != null) row.prefix = patch.prefix
  if (patch.padding != null) row.padding = Math.max(1, Math.min(12, Math.trunc(patch.padding)))
  if (patch.nextNumber != null) row.next_number = Math.max(1, Math.trunc(patch.nextNumber))
  const { error } = await admin().from('numbering_counters').upsert(row, { onConflict: 'tenant_id,doc_type' })
  return error ? { ok: false as const, error: error.message } : { ok: true as const }
}

// ── field definition + dropdown option admin ──
export async function updateDefinition(tenantId: string, id: string, patch: { label?: string; required?: boolean; sortOrder?: number; active?: boolean }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.label != null) row.label = patch.label
  if (patch.required != null) row.required = patch.required
  if (patch.sortOrder != null) row.sort_order = patch.sortOrder
  if (patch.active != null) row.active = patch.active
  const { data } = await admin().from('field_definitions').update(row).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
  return data ? { ok: true as const } : { ok: false as const, error: 'not_found' }
}
export async function addOption(tenantId: string, definitionId: string, value: string, label: string) {
  // scope check: definition must belong to the tenant
  const { data: def } = await admin().from('field_definitions').select('id').eq('tenant_id', tenantId).eq('id', definitionId).maybeSingle()
  if (!def) return { ok: false as const, error: 'definition_not_found' }
  const { count } = await admin().from('field_options').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('field_definition_id', definitionId)
  const { error } = await admin().from('field_options').insert({ tenant_id: tenantId, field_definition_id: definitionId, value, label, sort_order: count ?? 0 })
  return error ? { ok: false as const, error: error.message } : { ok: true as const }
}
export async function setOptionActive(tenantId: string, optionId: string, active: boolean) {
  const { data } = await admin().from('field_options').update({ active }).eq('tenant_id', tenantId).eq('id', optionId).select('id').maybeSingle()
  return data ? { ok: true as const } : { ok: false as const, error: 'not_found' }
}
