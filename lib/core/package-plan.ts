// Pure, dependency-free helpers for vertical schema-package installation. Kept server-import-free
// so it can be unit-tested offline. The DB-touching installer lives in lib/core/packages.ts.

export type InstallAction = 'install' | 'upgrade' | 'reinstall'

// Decide what an install call means given the tenant's currently-installed version (or null if never
// installed) and the package's catalog version. A same-version call is a REINSTALL (idempotent no-op
// in effect: definitions re-asserted, values preserved). A newer catalog version is an UPGRADE.
export function installAction(installedVersion: number | null | undefined, packageVersion: number): InstallAction {
  if (installedVersion == null) return 'install'
  if (packageVersion > installedVersion) return 'upgrade'
  return 'reinstall'
}

export interface PackageFieldTemplate {
  entity_type: string; key: string; label: string; field_type: string
  required: boolean; default_value: unknown; validation: Record<string, unknown>
  options: { value: string; label: string }[]; sort_order: number
}

// Normalize a raw package-field row (options stored as jsonb) into a clean template. Tolerates
// options arriving as an array, a JSON string, or null.
export function normalizeTemplate(row: {
  entity_type: string; key: string; label: string; field_type: string
  required?: boolean; default_value?: unknown; validation?: unknown; options?: unknown; sort_order?: number
}): PackageFieldTemplate {
  let options: { value: string; label: string }[] = []
  const raw = typeof row.options === 'string' ? safeJson(row.options) : row.options
  if (Array.isArray(raw)) {
    options = raw
      .filter((o): o is { value: string; label: string } => !!o && typeof o.value === 'string' && typeof o.label === 'string')
      .map((o) => ({ value: o.value, label: o.label }))
  }
  return {
    entity_type: row.entity_type, key: row.key, label: row.label, field_type: row.field_type,
    required: !!row.required, default_value: row.default_value ?? null,
    validation: (row.validation && typeof row.validation === 'object' ? row.validation : {}) as Record<string, unknown>,
    options, sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s) } catch { return null } }
