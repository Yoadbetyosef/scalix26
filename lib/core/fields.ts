import { createAdminClient } from '@/lib/supabase/server'
import { validateFieldValue, type FieldDef, type FieldType } from './field-validate'

// Attribute engine repository. Definitions are per-tenant + per entity_type; values are validated against
// the definition (type/required/options) before persistence. Vertical/tenant extension data only — never
// Core money/inventory/identity/lifecycle (those are typed columns). Tenant-scoped throughout.
const admin = () => createAdminClient()

export interface FieldDefinitionRow {
  id: string; tenant_id: string; entity_type: string; key: string; label: string; field_type: FieldType
  required: boolean; default_value: unknown; validation: FieldDef['validation']; sort_order: number; active: boolean
  options?: { value: string; label: string }[]
}

export async function listDefinitions(tenantId: string, entityType: string): Promise<FieldDefinitionRow[]> {
  const { data: defs } = await admin().from('field_definitions').select('*').eq('tenant_id', tenantId).eq('entity_type', entityType).eq('active', true).order('sort_order')
  const rows = (defs ?? []) as FieldDefinitionRow[]
  if (!rows.length) return rows
  const { data: opts } = await admin().from('field_options').select('field_definition_id, value, label, sort_order').eq('tenant_id', tenantId).in('field_definition_id', rows.map((r) => r.id)).eq('active', true).order('sort_order')
  const byDef = new Map<string, { value: string; label: string }[]>()
  for (const o of (opts ?? []) as Array<{ field_definition_id: string; value: string; label: string }>) {
    if (!byDef.has(o.field_definition_id)) byDef.set(o.field_definition_id, [])
    byDef.get(o.field_definition_id)!.push({ value: o.value, label: o.label })
  }
  return rows.map((r) => ({ ...r, options: byDef.get(r.id) ?? [] }))
}

export interface DefinitionInput { entityType: string; key: string; label: string; fieldType: FieldType; required?: boolean; validation?: FieldDef['validation']; sortOrder?: number; options?: { value: string; label: string }[] }
export async function createDefinition(tenantId: string, input: DefinitionInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await admin().from('field_definitions').insert({
    tenant_id: tenantId, entity_type: input.entityType, key: input.key.trim(), label: input.label.trim(),
    field_type: input.fieldType, required: !!input.required, validation: input.validation ?? {}, sort_order: input.sortOrder ?? 0,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const id = data.id as string
  if (input.options?.length) {
    await admin().from('field_options').insert(input.options.map((o, i) => ({ tenant_id: tenantId, field_definition_id: id, value: o.value, label: o.label, sort_order: i })))
  }
  return { ok: true, id }
}

const toFieldDef = (d: FieldDefinitionRow): FieldDef => ({ key: d.key, field_type: d.field_type, required: d.required, options: (d.options ?? []).map((o) => o.value), validation: d.validation ?? {} })

// Set (validate + upsert) an attribute value for a record. Returns a typed error the caller surfaces.
export async function setFieldValue(tenantId: string, recordType: string, recordId: string, key: string, rawValue: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const defs = await listDefinitions(tenantId, recordType)
  const def = defs.find((d) => d.key === key)
  if (!def) return { ok: false, error: 'unknown_field' }
  const res = validateFieldValue(toFieldDef(def), rawValue)
  if (!res.ok) return { ok: false, error: `${key}: ${res.error}` }
  const { error } = await admin().from('field_values').upsert(
    { tenant_id: tenantId, field_definition_id: def.id, record_type: recordType, record_id: recordId, value: res.value as never, updated_at: new Date().toISOString() },
    { onConflict: 'field_definition_id,record_id' },
  )
  return error ? { ok: false, error: error.message } : { ok: true }
}

// All attribute values for a record, keyed by field key.
export async function getFieldValues(tenantId: string, recordType: string, recordId: string): Promise<Record<string, unknown>> {
  const { data: vals } = await admin().from('field_values').select('field_definition_id, value').eq('tenant_id', tenantId).eq('record_type', recordType).eq('record_id', recordId)
  const rows = (vals ?? []) as Array<{ field_definition_id: string; value: unknown }>
  if (!rows.length) return {}
  const { data: defs } = await admin().from('field_definitions').select('id, key').eq('tenant_id', tenantId).in('id', rows.map((r) => r.field_definition_id))
  const keyById = new Map((defs ?? []).map((d) => [d.id as string, d.key as string]))
  const out: Record<string, unknown> = {}
  for (const r of rows) { const k = keyById.get(r.field_definition_id); if (k) out[k] = r.value }
  return out
}
