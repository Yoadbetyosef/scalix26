import { createAdminClient } from '@/lib/supabase/server'

// Public QR resolver — the ONE lookup behind /p/[token]. Resolves a component OR a variant (product- or
// component-owned) by its unguessable token and returns a normalized, CUSTOMER-SAFE shape (no cost/internal
// notes) enriched with parent context, effective category, vertical attributes (fabric/color/dimensions),
// and — for a component — its variant options. Core owns QR identity + routing; the fields come from the
// installed package + tenant data. Service-role read (public page, no auth), still token-scoped.
const admin = () => createAdminClient()

export interface PublicAttr { key: string; label: string; display: string; fieldType: string }
export interface PublicVariantOption { name: string; sku: string | null; price_cents: number | null; currency: string; token: string }
export interface PublicQr {
  level: 'component' | 'variant'
  productName: string | null
  parentName: string | null   // for a variant: the component (or product) it belongs to
  name: string
  sku: string | null
  image_url: string | null
  price_cents: number | null
  currency: string
  status: string
  category: string | null
  attributes: PublicAttr[]
  variants: PublicVariantOption[]
}

// Attribute values for a record, resolved to human labels (select values → option labels).
async function attributesFor(tenantId: string, recordType: string, recordId: string): Promise<PublicAttr[]> {
  const { data: vals } = await admin().from('field_values').select('field_definition_id, value').eq('tenant_id', tenantId).eq('record_type', recordType).eq('record_id', recordId)
  const rows = (vals ?? []) as Array<{ field_definition_id: string; value: unknown }>
  if (!rows.length) return []
  const { data: defs } = await admin().from('field_definitions').select('id, key, label, field_type').eq('tenant_id', tenantId).in('id', rows.map((r) => r.field_definition_id))
  const { data: opts } = await admin().from('field_options').select('field_definition_id, value, label').eq('tenant_id', tenantId).in('field_definition_id', rows.map((r) => r.field_definition_id))
  const defById = new Map((defs ?? []).map((d) => [d.id as string, d as { key: string; label: string; field_type: string }]))
  const optLabel = new Map((opts ?? []).map((o) => [`${o.field_definition_id}:${o.value}`, o.label as string]))
  const out: PublicAttr[] = []
  for (const r of rows) {
    const def = defById.get(r.field_definition_id); if (!def) continue
    let display: string
    if (Array.isArray(r.value)) display = r.value.map((v) => optLabel.get(`${r.field_definition_id}:${v}`) ?? String(v)).join(', ')
    else if (def.field_type === 'select') display = optLabel.get(`${r.field_definition_id}:${r.value}`) ?? String(r.value ?? '')
    else if (def.field_type === 'boolean') display = r.value ? 'Yes' : 'No'
    else display = r.value == null ? '' : String(r.value)
    if (display !== '') out.push({ key: def.key, label: def.label, display, fieldType: def.field_type })
  }
  return out
}

export async function resolveQrToken(token: string): Promise<PublicQr | null> {
  const { data: comp } = await admin().from('product_components')
    .select('id, tenant_id, product_id, name, sku, image_url, price_cents, currency, status, category, use_parent_category')
    .eq('qr_code_token', token).maybeSingle()
  if (comp) {
    const { data: product } = await admin().from('catalog_products').select('name, brand, category').eq('id', comp.product_id).maybeSingle()
    const category = comp.use_parent_category ? (product?.category ?? null) : (comp.category ?? null)
    const attributes = await attributesFor(comp.tenant_id, 'component', comp.id)
    const { data: vars } = await admin().from('product_variants').select('name, sku, price_override_cents, currency, status, qr_code_token').eq('tenant_id', comp.tenant_id).eq('component_id', comp.id).neq('status', 'discontinued').order('sort_order')
    const variants: PublicVariantOption[] = (vars ?? []).map((v) => ({ name: v.name as string, sku: (v.sku as string) ?? null, price_cents: (v.price_override_cents as number) ?? null, currency: (v.currency as string) || 'usd', token: v.qr_code_token as string }))
    return { level: 'component', productName: product?.name ?? null, parentName: null, name: comp.name as string, sku: comp.sku as string ?? null, image_url: comp.image_url as string ?? null, price_cents: comp.price_cents as number ?? null, currency: (comp.currency as string) || 'usd', status: comp.status as string, category, attributes, variants }
  }

  const { data: v } = await admin().from('product_variants')
    .select('id, tenant_id, product_id, component_id, name, sku, image_url, price_override_cents, currency, status')
    .eq('qr_code_token', token).maybeSingle()
  if (v) {
    let productName: string | null = null, parentName: string | null = null, category: string | null = null
    if (v.component_id) {
      const { data: c } = await admin().from('product_components').select('name, product_id, category, use_parent_category').eq('id', v.component_id).maybeSingle()
      parentName = c?.name ?? null
      if (c?.product_id) { const { data: p } = await admin().from('catalog_products').select('name, category').eq('id', c.product_id).maybeSingle(); productName = p?.name ?? null; category = c?.use_parent_category ? (p?.category ?? null) : (c?.category ?? null) }
    } else if (v.product_id) {
      const { data: p } = await admin().from('catalog_products').select('name, category').eq('id', v.product_id).maybeSingle(); productName = p?.name ?? null; category = p?.category ?? null
    }
    const attributes = await attributesFor(v.tenant_id, 'variant', v.id)
    return { level: 'variant', productName, parentName, name: v.name as string, sku: v.sku as string ?? null, image_url: v.image_url as string ?? null, price_cents: v.price_override_cents as number ?? null, currency: (v.currency as string) || 'usd', status: v.status as string, category, attributes, variants: [] }
  }
  return null
}
