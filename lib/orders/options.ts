import { createClient } from '@/lib/supabase/server'
import { requireOrdersAccess } from './guard'
import { keyFromLabel, templateById } from './option-templates'

// Tenant-managed dropdown lists for order line items.
//
// The tenant owns these outright — she adds, renames, reorders and retires options and whole lists from
// Settings without a developer. Nothing is ever seeded behind her back: a starter template is applied
// only when someone picks one (see ./option-templates), so a list she deletes stays deleted and a tenant
// in another trade never inherits another trade's vocabulary.
//
// Line items store the chosen LABEL, never a foreign key, so editing a list here can never rewrite or
// invalidate an order that was already placed.

export interface OrderOption { id: string; label: string; displayOrder: number; active: boolean }
export interface OrderOptionList { id: string; key: string; label: string; displayOrder: number; options: OrderOption[] }

const optionRow = (r: Record<string, unknown>): OrderOption => ({
  id: r.id as string, label: r.label as string, displayOrder: Number(r.display_order ?? 0), active: r.active !== false,
})

// All lists with their options. `activeOnly` powers the order form (retired options stay out of new
// orders); the Settings manager passes false so the tenant can see and revive what she deactivated.
export async function listOptionLists(activeOnly = true): Promise<OrderOptionList[]> {
  const a = await requireOrdersAccess(); if (!a) return []
  const sb = await createClient()

  const { data } = await sb.from('order_option_lists').select('*').eq('tenant_id', a.tenantId).order('display_order')
  const lists = (data as Array<Record<string, unknown>> | null) ?? []
  if (!lists.length) return []

  let q = sb.from('order_options').select('*').eq('tenant_id', a.tenantId).order('display_order')
  if (activeOnly) q = q.eq('active', true)
  const { data: opts } = await q
  const byList = new Map<string, OrderOption[]>()
  for (const r of ((opts as Array<Record<string, unknown>> | null) ?? [])) {
    const k = r.list_id as string
    if (!byList.has(k)) byList.set(k, [])
    byList.get(k)!.push(optionRow(r))
  }
  return lists.map((l) => ({
    id: l.id as string, key: l.key as string, label: l.label as string,
    displayOrder: Number(l.display_order ?? 0), options: byList.get(l.id as string) ?? [],
  }))
}

// ── Tenant edits ────────────────────────────────────────────────────────────────────────────────────
// Every mutation re-checks that the target list belongs to the caller's tenant before touching a row.

async function ownsList(tenantId: string, listId: string): Promise<boolean> {
  const sb = await createClient()
  const { data } = await sb.from('order_option_lists').select('id').eq('tenant_id', tenantId).eq('id', listId).maybeSingle()
  return !!data
}

// Apply a starter template. Only ever called from an explicit user action, and only fills gaps: a list
// the tenant already has (or deliberately deleted and doesn't want back) is left alone unless absent.
export async function applyTemplate(templateId: string): Promise<{ ok: boolean; error?: string; created?: number }> {
  const a = await requireOrdersAccess(); if (!a) return { ok: false, error: 'unauthorized' }
  const template = templateById(templateId)
  if (!template) return { ok: false, error: 'Unknown template.' }
  const sb = await createClient()

  const { data: existing } = await sb.from('order_option_lists').select('key, display_order').eq('tenant_id', a.tenantId)
  const have = new Set(((existing as Array<Record<string, unknown>> | null) ?? []).map((l) => l.key as string))
  let order = Math.max(0, ...((existing as Array<Record<string, unknown>> | null) ?? []).map((l) => Number(l.display_order ?? 0)))

  let created = 0
  for (const spec of template.lists) {
    if (have.has(spec.key)) continue
    const { data: list } = await sb.from('order_option_lists')
      .insert({ tenant_id: a.tenantId, key: spec.key, label: spec.label, display_order: ++order })
      .select('id').maybeSingle()
    if (!list) continue                       // lost a race with a concurrent apply — it exists now, fine
    await sb.from('order_options').insert(
      spec.options.map((label, i) => ({ tenant_id: a.tenantId, list_id: list.id as string, label, display_order: i })),
    )
    created++
  }
  return { ok: true, created }
}

// Create an empty list of the tenant's own — this is what makes the feature work for a trade that has no
// template at all.
export async function createList(label: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const a = await requireOrdersAccess(); if (!a) return { ok: false, error: 'unauthorized' }
  const clean = label.trim()
  if (!clean) return { ok: false, error: 'Enter a name for the list.' }
  const sb = await createClient()

  const { data: existing } = await sb.from('order_option_lists').select('key, display_order').eq('tenant_id', a.tenantId)
  const rows = (existing as Array<Record<string, unknown>> | null) ?? []
  const have = new Set(rows.map((l) => l.key as string))
  const order = Math.max(0, ...rows.map((l) => Number(l.display_order ?? 0))) + 1

  // Two lists may share a display name; their machine keys must still differ.
  const base = keyFromLabel(clean)
  let key = base
  for (let n = 2; have.has(key); n++) key = `${base}_${n}`

  const { data, error } = await sb.from('order_option_lists')
    .insert({ tenant_id: a.tenantId, key, label: clean, display_order: order }).select('id').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data.id as string }
}

export async function renameList(id: string, label: string): Promise<{ ok: boolean; error?: string }> {
  const a = await requireOrdersAccess(); if (!a) return { ok: false, error: 'unauthorized' }
  const clean = label.trim()
  if (!clean) return { ok: false, error: 'Enter a name for the list.' }
  const sb = await createClient()
  // The key stays as it was: renaming the label must not change what the order form looks up.
  const { error } = await sb.from('order_option_lists').update({ label: clean }).eq('tenant_id', a.tenantId).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Delete a whole list and its options (FK cascade). Past orders keep their stored label text, and the
// list will NOT come back on the next page load.
export async function deleteList(id: string): Promise<boolean> {
  const a = await requireOrdersAccess(); if (!a) return false
  const sb = await createClient()
  const { error } = await sb.from('order_option_lists').delete().eq('tenant_id', a.tenantId).eq('id', id)
  return !error
}

export async function addOption(listId: string, label: string): Promise<{ ok: boolean; error?: string; option?: OrderOption }> {
  const a = await requireOrdersAccess(); if (!a) return { ok: false, error: 'unauthorized' }
  const clean = label.trim()
  if (!clean) return { ok: false, error: 'Enter a name for the option.' }
  if (!(await ownsList(a.tenantId, listId))) return { ok: false, error: 'not found' }
  const sb = await createClient()
  // Append to the end of the list.
  const { data: last } = await sb.from('order_options').select('display_order').eq('list_id', listId).order('display_order', { ascending: false }).limit(1).maybeSingle()
  const next = Number(last?.display_order ?? -1) + 1
  const { data, error } = await sb.from('order_options')
    .insert({ tenant_id: a.tenantId, list_id: listId, label: clean, display_order: next }).select('*').single()
  if (error) return { ok: false, error: error.code === '23505' ? `"${clean}" is already in this list.` : error.message }
  return { ok: true, option: optionRow(data as Record<string, unknown>) }
}

export async function updateOption(id: string, patch: { label?: string; active?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const a = await requireOrdersAccess(); if (!a) return { ok: false, error: 'unauthorized' }
  const m: Record<string, unknown> = {}
  if (patch.label !== undefined) {
    const clean = patch.label.trim()
    if (!clean) return { ok: false, error: 'Enter a name for the option.' }
    m.label = clean
  }
  if (patch.active !== undefined) m.active = patch.active
  if (!Object.keys(m).length) return { ok: true }
  const sb = await createClient()
  const { error } = await sb.from('order_options').update(m).eq('tenant_id', a.tenantId).eq('id', id)
  if (error) return { ok: false, error: error.code === '23505' ? 'That name is already in this list.' : error.message }
  return { ok: true }
}

// Hard delete. Historic orders keep their stored label text, so removing an option is always safe.
export async function deleteOption(id: string): Promise<boolean> {
  const a = await requireOrdersAccess(); if (!a) return false
  const sb = await createClient()
  const { error } = await sb.from('order_options').delete().eq('tenant_id', a.tenantId).eq('id', id)
  return !error
}

// Persist a reorder: ids in their new visual order.
export async function reorderOptions(listId: string, orderedIds: string[]): Promise<boolean> {
  const a = await requireOrdersAccess(); if (!a) return false
  if (!(await ownsList(a.tenantId, listId))) return false
  const sb = await createClient()
  await Promise.all(orderedIds.map((id, i) =>
    sb.from('order_options').update({ display_order: i }).eq('tenant_id', a.tenantId).eq('list_id', listId).eq('id', id),
  ))
  return true
}
