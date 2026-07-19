import type { FieldType } from './field-validate'
import { centsToInput, inputToCents } from './money-format'

// Pure, dependency-light helpers for the dynamic attribute UI (no React/server imports) so they unit-test
// cleanly. Convert a stored field value ↔ form state, and coerce form state to the typed value the server
// validator expects (integer cents for money, numbers for integer/decimal, arrays for multi_select).
export interface FieldDef {
  id: string; key: string; label: string; field_type: FieldType; required: boolean
  validation?: Record<string, unknown> | null; options?: { value: string; label: string }[]
  source_package_id?: string | null
}
export type FieldState = string | boolean | string[]

export function initialFieldState(def: FieldDef, value: unknown): FieldState {
  if (def.field_type === 'boolean') return value === true
  if (def.field_type === 'multi_select') return Array.isArray(value) ? value.map(String) : []
  if (def.field_type === 'money') return centsToInput(typeof value === 'number' ? value : null)
  if (value == null) return ''
  return String(value)
}

export function coerceFieldValue(def: FieldDef, state: FieldState): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (def.field_type) {
    case 'boolean': return { ok: true, value: state === true }
    case 'multi_select': return { ok: true, value: Array.isArray(state) ? state : [] }
    case 'integer': {
      if (state === '') return { ok: true, value: null }
      const n = Number(state); if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${def.label} must be a whole number` }
      return { ok: true, value: n }
    }
    case 'decimal': {
      if (state === '') return { ok: true, value: null }
      const n = Number(state); if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number` }
      return { ok: true, value: n }
    }
    case 'money': {
      const cents = inputToCents(String(state)); if (Number.isNaN(cents)) return { ok: false, error: `${def.label} must be a valid amount` }
      return { ok: true, value: cents }
    }
    default: {
      const s = typeof state === 'string' ? state.trim() : ''
      return { ok: true, value: s === '' ? null : s }
    }
  }
}
