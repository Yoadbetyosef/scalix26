// Pure validation/coercion of an attribute value against its field definition. Unit-tested; no I/O.
// This is the correctness core of the configurable attribute engine — verticals define fields, the Core
// only understands field types + validates values. Money fields are integer minor units (cents).

export type FieldType =
  | 'text' | 'long_text' | 'integer' | 'decimal' | 'money' | 'boolean' | 'date' | 'datetime'
  | 'select' | 'multi_select' | 'file' | 'image'
  | 'contact_relation' | 'company_relation' | 'product_relation' | 'variant_relation' | 'user_relation' | 'record_relation'

export interface FieldDef {
  key: string; field_type: FieldType; required?: boolean
  options?: string[]                 // for select / multi_select
  validation?: { min?: number; max?: number; maxLength?: number }
}
export type ValidateResult = { ok: true; value: unknown } | { ok: false; error: string }

const UUID = /^[0-9a-fA-F-]{36}$/
const num = (raw: unknown, def: FieldDef): ValidateResult => {
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false, error: 'expected_number' }
  if (def.field_type === 'integer' && !Number.isInteger(n)) return { ok: false, error: 'expected_integer' }
  if (def.field_type === 'money' && !Number.isInteger(n)) return { ok: false, error: 'money_must_be_integer_minor_units' }
  if (def.validation?.min != null && n < def.validation.min) return { ok: false, error: 'below_min' }
  if (def.validation?.max != null && n > def.validation.max) return { ok: false, error: 'above_max' }
  return { ok: true, value: n }
}

export function validateFieldValue(def: FieldDef, raw: unknown): ValidateResult {
  const empty = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)
  if (empty) return def.required ? { ok: false, error: 'required' } : { ok: true, value: null }

  switch (def.field_type) {
    case 'text':
    case 'long_text': {
      if (typeof raw !== 'string') return { ok: false, error: 'expected_text' }
      if (def.validation?.maxLength != null && raw.length > def.validation.maxLength) return { ok: false, error: 'too_long' }
      return { ok: true, value: raw }
    }
    case 'integer': case 'decimal': case 'money': return num(raw, def)
    case 'boolean':
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' }
      return { ok: false, error: 'expected_boolean' }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? { ok: true, value: String(raw) } : { ok: false, error: 'expected_date' }
    case 'datetime': {
      const t = Date.parse(String(raw))
      return Number.isFinite(t) ? { ok: true, value: new Date(t).toISOString() } : { ok: false, error: 'expected_datetime' }
    }
    case 'select':
      return def.options?.includes(String(raw)) ? { ok: true, value: String(raw) } : { ok: false, error: 'invalid_option' }
    case 'multi_select': {
      const arr = (Array.isArray(raw) ? raw : [raw]).map(String)
      return arr.every((v) => def.options?.includes(v)) ? { ok: true, value: arr } : { ok: false, error: 'invalid_option' }
    }
    case 'file': case 'image':
      return typeof raw === 'string' && raw.length > 0 ? { ok: true, value: raw } : { ok: false, error: 'expected_url_or_id' }
    // relations store a referenced id (record_relation may be an array)
    case 'record_relation': {
      const arr = (Array.isArray(raw) ? raw : [raw]).map(String)
      return arr.every((v) => UUID.test(v)) ? { ok: true, value: arr } : { ok: false, error: 'expected_relation_id' }
    }
    default:
      return typeof raw === 'string' && UUID.test(raw) ? { ok: true, value: raw } : { ok: false, error: 'expected_relation_id' }
  }
}
