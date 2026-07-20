import { createAdminClient } from '@/lib/supabase/server'

// Generic material/finish library (UI: "Fabrics" for furniture). Separate from product variants. V1: manual
// status, simple metadata, product links. Snapshots are copied onto proposal/order lines so they survive
// catalog changes. Internally "material" — the label is tenant-configurable terminology.
const admin = () => createAdminClient()
const now = () => new Date().toISOString()

export const MATERIAL_STATUSES = ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'] as const
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number]
const COLS = 'id, name, code, image_url, color, composition, martindale, width, weight, notes, status, created_at, updated_at'

export interface MaterialInput { name: string; code?: string | null; image_url?: string | null; color?: string | null; composition?: string | null; martindale?: string | null; width?: string | null; weight?: string | null; notes?: string | null; status?: MaterialStatus }

export async function listMaterials(tenantId: string, opts: { search?: string; status?: string } = {}) {
  let q = admin().from('catalog_materials').select(COLS).eq('tenant_id', tenantId).is('archived_at', null)
  if (opts.status && (MATERIAL_STATUSES as readonly string[]).includes(opts.status)) q = q.eq('status', opts.status)
  const { data } = await q.order('name')
  let rows = (data ?? []) as Record<string, unknown>[]
  const s = opts.search?.trim().toLowerCase()
  if (s) rows = rows.filter((m) => [m.name, m.code, m.color].some((v) => (v as string)?.toLowerCase().includes(s)))
  return rows
}

export async function getMaterial(tenantId: string, id: string) {
  const { data } = await admin().from('catalog_materials').select(COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return data ?? null
}

export async function createMaterial(tenantId: string, input: MaterialInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.name?.trim()) return { ok: false, error: 'name_required' }
  const { data, error } = await admin().from('catalog_materials').insert({ tenant_id: tenantId, ...clean(input) }).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id as string }
}

export async function updateMaterial(tenantId: string, id: string, patch: Partial<MaterialInput>): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin().from('catalog_materials').update({ ...clean(patch), updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteMaterial(tenantId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Hard delete — product links cascade; proposal/order snapshots are independent copies, so history survives.
  const { error } = await admin().from('catalog_materials').delete().eq('tenant_id', tenantId).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

function clean(input: Partial<MaterialInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['name', 'code', 'image_url', 'color', 'composition', 'martindale', 'width', 'weight', 'notes', 'status'] as const) if (input[k] !== undefined) out[k] = typeof input[k] === 'string' ? (input[k] as string).trim() || null : input[k]
  if (out.name === null) delete out.name
  return out
}

// ── Product ↔ material links ─────────────────────────────────────────────────────────────────────────
export async function listProductMaterials(tenantId: string, productId: string) {
  const { data } = await admin().from('product_materials').select(`material_id, catalog_materials!inner(${COLS})`).eq('tenant_id', tenantId).eq('product_id', productId)
  return ((data ?? []) as unknown as Array<{ catalog_materials: Record<string, unknown> | Record<string, unknown>[] }>)
    .map((r) => (Array.isArray(r.catalog_materials) ? r.catalog_materials[0] : r.catalog_materials))
    .filter(Boolean) as Record<string, unknown>[]
}

export async function setProductMaterials(tenantId: string, productId: string, materialIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: prod } = await admin().from('catalog_products').select('id').eq('tenant_id', tenantId).eq('id', productId).maybeSingle()
  if (!prod) return { ok: false, error: 'product_not_found' }
  const ids = [...new Set(materialIds)]
  if (ids.length) { const { data: valid } = await admin().from('catalog_materials').select('id').eq('tenant_id', tenantId).in('id', ids); if ((valid ?? []).length !== ids.length) return { ok: false, error: 'invalid_material' } }
  await admin().from('product_materials').delete().eq('tenant_id', tenantId).eq('product_id', productId)
  if (ids.length) await admin().from('product_materials').insert(ids.map((mid) => ({ tenant_id: tenantId, product_id: productId, material_id: mid })))
  return { ok: true }
}

// Customer-safe snapshot copied onto a proposal/order line (kept forever, even if the catalog changes).
export function materialSnapshot(m: Record<string, unknown>) {
  return { fabric_id: m.id as string, name: (m.name as string) ?? null, code: (m.code as string) ?? null, image_url: (m.image_url as string) ?? null, color: (m.color as string) ?? null, composition: (m.composition as string) ?? null, martindale: (m.martindale as string) ?? null, width: (m.width as string) ?? null, weight: (m.weight as string) ?? null, status: (m.status as string) ?? null }
}
