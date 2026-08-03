import { createClient } from '@/lib/supabase/server'
import { requireOrdersAccess } from './guard'

// Tenant-managed dropdown lists for order line items (stone quality, shapes, karat, …).
// The tenant owns these outright — she adds, renames, reorders and retires options from Settings without
// a developer. Line items store the chosen LABEL, never a foreign key, so editing a list here can never
// rewrite or invalidate an order that was already placed.

export const OPTION_LIST_KEYS = [
  'stone_quality', 'stone_color', 'stone_origin', 'stone_type',
  'center_stone_shape', 'side_stone_shape', 'metal_karat',
] as const
export type OptionListKey = (typeof OPTION_LIST_KEYS)[number]

export interface OrderOption { id: string; label: string; displayOrder: number; active: boolean }
export interface OrderOptionList { id: string; key: OptionListKey; label: string; displayOrder: number; options: OrderOption[] }

// Seeded once per tenant, then fully theirs to edit. Mirrors the SQL seed in add_orders_4_jewelry.sql —
// this copy covers tenants who enable Orders after that migration ran.
const DEFAULTS: Array<{ key: OptionListKey; label: string; options: string[] }> = [
  { key: 'stone_quality', label: 'Stone quality', options: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'] },
  { key: 'stone_color', label: 'Stone colour', options: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'Fancy Yellow', 'Fancy Pink', 'Fancy Blue'] },
  { key: 'stone_origin', label: 'Natural or Lab Grown', options: ['Natural', 'Lab Grown'] },
  { key: 'stone_type', label: 'Stone type', options: ['Diamond', 'Ruby', 'Sapphire', 'Emerald', 'Moissanite', 'Aquamarine', 'Tanzanite', 'Morganite', 'Amethyst', 'Topaz', 'Garnet', 'Peridot', 'Tourmaline', 'Opal', 'Pearl'] },
  { key: 'center_stone_shape', label: 'Center stone shape', options: ['Round', 'Oval', 'Princess', 'Cushion', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Asscher', 'Heart', 'Trillion', 'Baguette'] },
  { key: 'side_stone_shape', label: 'Side stone shape', options: ['Round', 'Oval', 'Princess', 'Cushion', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Asscher', 'Heart', 'Trillion', 'Baguette', 'Tapered Baguette'] },
  { key: 'metal_karat', label: 'Gold karat / metal', options: ['10K Yellow Gold', '10K White Gold', '10K Rose Gold', '14K Yellow Gold', '14K White Gold', '14K Rose Gold', '18K Yellow Gold', '18K White Gold', '18K Rose Gold', 'Platinum', 'Sterling Silver'] },
]

const optionRow = (r: Record<string, unknown>): OrderOption => ({
  id: r.id as string, label: r.label as string, displayOrder: Number(r.display_order ?? 0), active: r.active !== false,
})

// Create any missing default list for this tenant. Only ever fills gaps — a list the tenant has already
// customised (or emptied) is left exactly as it is.
async function seedMissingLists(tenantId: string, existingKeys: Set<string>): Promise<boolean> {
  const missing = DEFAULTS.filter((d) => !existingKeys.has(d.key))
  if (!missing.length) return false
  const sb = await createClient()
  for (const d of missing) {
    const { data } = await sb.from('order_option_lists')
      .insert({ tenant_id: tenantId, key: d.key, label: d.label, display_order: DEFAULTS.indexOf(d) + 1 })
      .select('id').maybeSingle()
    if (!data) continue // lost a race with a concurrent request — the list exists, that's fine
    await sb.from('order_options').insert(
      d.options.map((label, i) => ({ tenant_id: tenantId, list_id: data.id as string, label, display_order: i })),
    )
  }
  return true
}

// All lists with their options. `activeOnly` powers the order form (retired options stay out of new
// orders); the Settings manager passes false so the tenant can see and revive what she deactivated.
export async function listOptionLists(activeOnly = true): Promise<OrderOptionList[]> {
  const a = await requireOrdersAccess(); if (!a) return []
  const sb = await createClient()

  const load = async () => {
    const { data } = await sb.from('order_option_lists').select('*').eq('tenant_id', a.tenantId).order('display_order')
    return (data as Array<Record<string, unknown>> | null) ?? []
  }
  let lists = await load()
  if (await seedMissingLists(a.tenantId, new Set(lists.map((l) => l.key as string)))) lists = await load()
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
    id: l.id as string, key: l.key as OptionListKey, label: l.label as string,
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

// Persist a drag-reorder: ids in their new visual order.
export async function reorderOptions(listId: string, orderedIds: string[]): Promise<boolean> {
  const a = await requireOrdersAccess(); if (!a) return false
  if (!(await ownsList(a.tenantId, listId))) return false
  const sb = await createClient()
  await Promise.all(orderedIds.map((id, i) =>
    sb.from('order_options').update({ display_order: i }).eq('tenant_id', a.tenantId).eq('list_id', listId).eq('id', id),
  ))
  return true
}
