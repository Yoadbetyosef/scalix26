import { createAdminClient } from '@/lib/supabase/server'
import { installAction, normalizeTemplate, type InstallAction } from './package-plan'

// Vertical schema-package installer. A package is a reusable bundle of field templates; installing it
// for a tenant materializes those templates as that tenant's field_definitions (+ options), tagged with
// source_package_id so package fields are distinguishable from tenant-authored custom fields. Idempotent:
// re-installing upserts the same definitions (stable ids) so tenant field_values are never lost. A tenant
// that installs only Jewelry receives ZERO furniture fields. Tenant-scoped throughout (admin client +
// explicit tenant_id — never trust a client-supplied tenant_id).
const admin = () => createAdminClient()

export interface PackageSummary { id: string; key: string; name: string; version: number; description: string | null; status: string; fieldCount: number }
export interface InstalledPackage { key: string; name: string; version: number; installedVersion: number; installedAt: string; status: string; upgradeAvailable: boolean }

// The global catalog of installable packages (published only), with template counts.
export async function listPackages(): Promise<PackageSummary[]> {
  const { data: pkgs } = await admin().from('vertical_schema_packages').select('id, key, name, version, description, status').eq('status', 'published').order('name')
  const rows = (pkgs ?? []) as Array<Omit<PackageSummary, 'fieldCount'>>
  if (!rows.length) return []
  const { data: fields } = await admin().from('vertical_schema_package_fields').select('package_id').in('package_id', rows.map((r) => r.id))
  const counts = new Map<string, number>()
  for (const f of (fields ?? []) as Array<{ package_id: string }>) counts.set(f.package_id, (counts.get(f.package_id) ?? 0) + 1)
  return rows.map((r) => ({ ...r, fieldCount: counts.get(r.id) ?? 0 }))
}

// Packages this tenant has installed (status='installed'), flagged if a newer catalog version exists.
export async function listInstalledPackages(tenantId: string): Promise<InstalledPackage[]> {
  const { data } = await admin().from('tenant_schema_installations')
    .select('installed_version, installed_at, status, vertical_schema_packages ( key, name, version )')
    .eq('tenant_id', tenantId).eq('status', 'installed')
  type Row = { installed_version: number; installed_at: string; status: string; vertical_schema_packages: { key: string; name: string; version: number } | null }
  return ((data ?? []) as unknown as Row[]).filter((r) => r.vertical_schema_packages).map((r) => ({
    key: r.vertical_schema_packages!.key, name: r.vertical_schema_packages!.name, version: r.vertical_schema_packages!.version,
    installedVersion: r.installed_version, installedAt: r.installed_at, status: r.status,
    upgradeAvailable: r.vertical_schema_packages!.version > r.installed_version,
  }))
}

export interface InstallResult { ok: true; action: InstallAction; fields: number; version: number }
export interface InstallError { ok: false; error: string }

// Install (or upgrade / reinstall) a package for a tenant. Idempotent + non-destructive: field_definitions
// are upserted on (tenant_id, entity_type, key) so ids are stable and field_values survive; field_options
// are upserted on (field_definition_id, value) so existing option-backed values survive.
export async function installPackage(tenantId: string, packageKey: string, actor: string | null): Promise<InstallResult | InstallError> {
  const { data: pkg } = await admin().from('vertical_schema_packages').select('id, version, status').eq('key', packageKey).maybeSingle()
  if (!pkg || pkg.status !== 'published') return { ok: false, error: 'package_not_found' }

  const { data: rawFields } = await admin().from('vertical_schema_package_fields')
    .select('entity_type, key, label, field_type, required, default_value, validation, options, sort_order')
    .eq('package_id', pkg.id).order('sort_order')
  const templates = ((rawFields ?? []) as Parameters<typeof normalizeTemplate>[0][]).map(normalizeTemplate)
  if (!templates.length) return { ok: false, error: 'package_has_no_fields' }

  const { data: current } = await admin().from('tenant_schema_installations').select('installed_version').eq('tenant_id', tenantId).eq('package_id', pkg.id).maybeSingle()
  const action = installAction(current?.installed_version ?? null, pkg.version)
  const now = new Date().toISOString()

  const defRows = templates.map((t) => ({
    tenant_id: tenantId, entity_type: t.entity_type, key: t.key, label: t.label, field_type: t.field_type,
    required: t.required, validation: (t.validation ?? {}) as never, default_value: (t.default_value ?? null) as never,
    sort_order: t.sort_order, source_package_id: pkg.id, active: true, updated_at: now,
  }))
  const { data: upserted, error: defErr } = await admin().from('field_definitions')
    .upsert(defRows, { onConflict: 'tenant_id,entity_type,key' }).select('id, entity_type, key')
  if (defErr) return { ok: false, error: defErr.message }

  const idByKey = new Map<string, string>()
  for (const d of (upserted ?? []) as Array<{ id: string; entity_type: string; key: string }>) idByKey.set(`${d.entity_type}:${d.key}`, d.id)

  const optRows: Array<{ tenant_id: string; field_definition_id: string; value: string; label: string; sort_order: number; active: boolean }> = []
  for (const t of templates) {
    if (!t.options.length) continue
    const defId = idByKey.get(`${t.entity_type}:${t.key}`)
    if (!defId) continue
    t.options.forEach((o, i) => optRows.push({ tenant_id: tenantId, field_definition_id: defId, value: o.value, label: o.label, sort_order: i, active: true }))
  }
  if (optRows.length) {
    const { error: optErr } = await admin().from('field_options').upsert(optRows, { onConflict: 'field_definition_id,value' })
    if (optErr) return { ok: false, error: optErr.message }
  }

  const { error: instErr } = await admin().from('tenant_schema_installations').upsert(
    { tenant_id: tenantId, package_id: pkg.id, installed_version: pkg.version, installed_by: actor, status: 'installed', installed_at: now, updated_at: now },
    { onConflict: 'tenant_id,package_id' },
  )
  if (instErr) return { ok: false, error: instErr.message }

  // Seed the package's default categories — insert-only (ignoreDuplicates) so a tenant's renames/reorder/
  // archives are never clobbered on re-install; only brand-new categories are added.
  const { data: pkgCats } = await admin().from('vertical_schema_package_categories').select('group_label, name, sort_order').eq('package_id', pkg.id).order('sort_order')
  if (pkgCats?.length) {
    await admin().from('product_categories').upsert(
      (pkgCats as Array<{ group_label: string | null; name: string; sort_order: number }>).map((cat) => ({ tenant_id: tenantId, name: cat.name, group_label: cat.group_label, sort_order: cat.sort_order, source_package_id: pkg.id })),
      { onConflict: 'tenant_id,name', ignoreDuplicates: true },
    )
  }

  return { ok: true, action, fields: templates.length, version: pkg.version }
}

// Non-destructive uninstall: mark the installation uninstalled and DEACTIVATE (never delete) the package's
// field_definitions for this tenant, so tenant-entered field_values are preserved and reinstalling restores them.
export async function uninstallPackage(tenantId: string, packageKey: string): Promise<{ ok: true; deactivated: number } | InstallError> {
  const { data: pkg } = await admin().from('vertical_schema_packages').select('id').eq('key', packageKey).maybeSingle()
  if (!pkg) return { ok: false, error: 'package_not_found' }
  const now = new Date().toISOString()
  const { data: deac } = await admin().from('field_definitions').update({ active: false, updated_at: now })
    .eq('tenant_id', tenantId).eq('source_package_id', pkg.id).select('id')
  await admin().from('tenant_schema_installations').update({ status: 'uninstalled', updated_at: now }).eq('tenant_id', tenantId).eq('package_id', pkg.id)
  return { ok: true, deactivated: (deac ?? []).length }
}
