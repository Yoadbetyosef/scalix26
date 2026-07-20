import { createAdminClient } from '@/lib/supabase/server'
import { getBranding, type Branding } from './proposal-branding'

// Shared assembly of a customer-safe, renderable proposal — used by BOTH the public token page and the
// internal (authenticated) preview page, so what the owner previews is exactly what the customer sees.
// Never includes cost or internal notes. Reuses catalog images (product_media / image_url) + the attribute
// engine (field_values) — no duplicate image or attribute storage.
const admin = () => createAdminClient()

// Flat { key: {label, value} } of an entity's attribute values, resolved to human labels.
async function attributeMap(tenantId: string, recordType: string, recordId: string): Promise<Record<string, { label: string; value: string }>> {
  const { data: vals } = await admin().from('field_values').select('field_definition_id, value').eq('tenant_id', tenantId).eq('record_type', recordType).eq('record_id', recordId)
  const rows = (vals ?? []) as Array<{ field_definition_id: string; value: unknown }>
  if (!rows.length) return {}
  const ids = rows.map((r) => r.field_definition_id)
  const [{ data: defs }, { data: opts }] = await Promise.all([
    admin().from('field_definitions').select('id, key, label, field_type').eq('tenant_id', tenantId).in('id', ids),
    admin().from('field_options').select('field_definition_id, value, label').eq('tenant_id', tenantId).in('field_definition_id', ids),
  ])
  const defById = new Map((defs ?? []).map((d) => [d.id as string, d as { key: string; label: string; field_type: string }]))
  const optLabel = new Map((opts ?? []).map((o) => [`${o.field_definition_id}:${o.value}`, o.label as string]))
  const out: Record<string, { label: string; value: string }> = {}
  for (const r of rows) {
    const def = defById.get(r.field_definition_id); if (!def) continue
    let display: string
    if (Array.isArray(r.value)) display = r.value.map((v) => optLabel.get(`${r.field_definition_id}:${v}`) ?? String(v)).join(', ')
    else if (def.field_type === 'select') display = optLabel.get(`${r.field_definition_id}:${r.value}`) ?? String(r.value ?? '')
    else if (def.field_type === 'boolean') display = r.value ? 'Yes' : 'No'
    else display = r.value == null ? '' : String(r.value)
    if (display !== '') out[def.key] = { label: def.label, value: display }
  }
  return out
}

async function primaryProductImage(tenantId: string, productId: string): Promise<string | null> {
  const { data } = await admin().from('product_media').select('url').eq('tenant_id', tenantId).eq('product_id', productId).eq('kind', 'image').order('sort_order').limit(1).maybeSingle()
  return (data?.url as string) ?? null
}

export interface LineSnapshot {
  image_url: string | null
  product_name: string | null
  component_name: string | null
  variant_name: string | null
  sku: string | null
  description: string | null
  color: string | null
  fabric: string | null
  measurements: string | null
  attributes: Record<string, string>   // label → value (for display), excludes color/fabric/measurements
}

// Resolve + snapshot the visual/spec fields for a catalog line (product → component → variant).
export async function resolveLineSnapshot(tenantId: string, ref: { productId?: string | null; componentId?: string | null; variantId?: string | null }): Promise<LineSnapshot> {
  let product_name: string | null = null, component_name: string | null = null, variant_name: string | null = null
  let sku: string | null = null, description: string | null = null, image_url: string | null = null
  const attrMaps: Record<string, { label: string; value: string }>[] = []

  if (ref.productId) {
    const { data: p } = await admin().from('catalog_products').select('name, sku, description').eq('tenant_id', tenantId).eq('id', ref.productId).maybeSingle()
    if (p) { product_name = (p.name as string) ?? null; sku = (p.sku as string) ?? sku; description = (p.description as string) ?? description }
    image_url = await primaryProductImage(tenantId, ref.productId)
    attrMaps.push(await attributeMap(tenantId, 'product', ref.productId))
  }
  if (ref.componentId) {
    const { data: c } = await admin().from('product_components').select('name, sku, description, image_url').eq('tenant_id', tenantId).eq('id', ref.componentId).maybeSingle()
    if (c) { component_name = (c.name as string) ?? null; sku = (c.sku as string) ?? sku; description = (c.description as string) ?? description; if (c.image_url) image_url = c.image_url as string }
    attrMaps.push(await attributeMap(tenantId, 'component', ref.componentId))
  }
  if (ref.variantId) {
    const { data: v } = await admin().from('product_variants').select('name, sku, image_url').eq('tenant_id', tenantId).eq('id', ref.variantId).maybeSingle()
    if (v) { variant_name = (v.name as string) ?? null; sku = (v.sku as string) ?? sku; if (v.image_url) image_url = v.image_url as string }
    attrMaps.push(await attributeMap(tenantId, 'variant', ref.variantId))
  }

  // Merge attributes (later scopes win) then pull out color/fabric/dimensions for first-class display.
  const merged: Record<string, { label: string; value: string }> = Object.assign({}, ...attrMaps)
  const byKey = (k: string) => merged[k]?.value ?? null
  const color = byKey('color')
  const fabric = byKey('fabric') ?? byKey('material')
  const dims = ['width_cm', 'height_cm', 'depth_cm'].map((k) => merged[k]?.value).filter(Boolean)
  const measurements = byKey('measurements') ?? byKey('dimensions') ?? (dims.length ? dims.join(' × ') + ' cm' : null)
  const attributes: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged)) if (!['color', 'fabric', 'material', 'width_cm', 'height_cm', 'depth_cm', 'measurements', 'dimensions'].includes(k)) attributes[v.label] = v.value

  return { image_url, product_name, component_name, variant_name, sku, description, color, fabric, measurements, attributes }
}

export const TEMPLATES = ['clean', 'visual', 'minimal'] as const
export type ProposalTemplate = (typeof TEMPLATES)[number]

export interface RenderFabric { name: string | null; code: string | null; image_url: string | null; color: string | null; composition: string | null; martindale: string | null }
export interface RenderLine { description: string | null; quantity: number; unit_price_cents: number; discount_cents: number; line_total_cents: number; image_url: string | null; sku: string | null; product_name: string | null; component_name: string | null; variant_name: string | null; color: string | null; fabric: string | null; measurements: string | null; attributes: Record<string, string>; fabricPick: RenderFabric | null }
export interface RenderSection { title: string; body: string }
export interface RenderableProposal {
  number: string; title: string | null; status: string; is_expired: boolean; template: ProposalTemplate
  branding: Branding
  customer: { name: string | null; company: string | null; email: string | null; phone: string | null; address: string | null }
  created_at: string | null; expires_at: string | null
  intro: string | null; scope: string | null; sections: RenderSection[]; terms: string | null
  currency: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number
  accepted_at: string | null; declined_at: string | null
  canRespond: boolean
  lines: RenderLine[]
}

// Assemble the renderable from a proposal row + its lines + resolved customer + branding + sections. Pure-ish.
export async function assembleRenderable(tenantId: string, doc: Record<string, unknown>, lines: Record<string, unknown>[], contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null, company: { name?: string | null } | null, sections: Record<string, unknown>[] = []): Promise<RenderableProposal> {
  const branding = await getBranding(tenantId)
  const expired = !!doc.expires_at && new Date(doc.expires_at as string) < new Date() && !['accepted', 'declined', 'converted'].includes(doc.status as string)
  const template = (TEMPLATES.includes(doc.template as ProposalTemplate) ? doc.template : 'clean') as ProposalTemplate
  const renderLines: RenderLine[] = lines.map((l) => {
    const a = (l.custom_attributes as Record<string, unknown>) ?? {}
    const snap = (a as { snapshot?: LineSnapshot }).snapshot ?? null
    const hidden = a.hide_image === true
    const override = (a.proposal_image_url as string) || null
    const image = hidden ? null : (override ?? snap?.image_url ?? (a.image_url as string) ?? null)
    const fp = (a.fabric as Record<string, unknown>) ?? null
    return {
      description: (l.description as string) ?? null, quantity: l.quantity as number, unit_price_cents: l.unit_price_cents as number,
      discount_cents: (l.discount_cents as number) ?? 0, line_total_cents: l.line_total_cents as number,
      image_url: image, sku: snap?.sku ?? (a.sku as string) ?? null,
      product_name: snap?.product_name ?? null, component_name: snap?.component_name ?? null, variant_name: snap?.variant_name ?? null,
      color: snap?.color ?? null, fabric: snap?.fabric ?? null, measurements: snap?.measurements ?? null, attributes: snap?.attributes ?? {},
      fabricPick: fp ? { name: (fp.name as string) ?? null, code: (fp.code as string) ?? null, image_url: (fp.image_url as string) ?? null, color: (fp.color as string) ?? null, composition: (fp.composition as string) ?? null, martindale: (fp.martindale as string) ?? null } : null,
    }
  })
  const visibleSections: RenderSection[] = (sections ?? []).filter((s) => s.visible !== false && ((s.title as string)?.trim() || (s.body as string)?.trim())).map((s) => ({ title: (s.title as string) ?? '', body: (s.body as string) ?? '' }))
  return {
    number: doc.number as string, title: (doc.title as string) ?? null, status: expired ? 'expired' : (doc.status as string), is_expired: expired, template, branding,
    customer: { name: (contact?.name as string) ?? null, company: (company?.name as string) ?? null, email: (contact?.email as string) ?? null, phone: (contact?.phone as string) ?? null, address: (contact?.address as string) ?? null },
    created_at: (doc.created_at as string) ?? null, expires_at: (doc.expires_at as string) ?? null,
    intro: (doc.customer_notes as string) ?? branding.intro ?? null, scope: (doc.scope as string) ?? null, sections: visibleSections, terms: (doc.terms as string) ?? branding.default_terms ?? null,
    currency: doc.currency as string, subtotal_cents: doc.subtotal_cents as number, discount_cents: doc.discount_cents as number, tax_cents: doc.tax_cents as number, total_cents: doc.total_cents as number,
    accepted_at: (doc.accepted_at as string) ?? null, declined_at: (doc.declined_at as string) ?? null,
    canRespond: !expired && !['accepted', 'declined', 'converted'].includes(doc.status as string),
    lines: renderLines,
  }
}

// Internal preview: fetch a proposal by id, tenant-scoped, and assemble — NO view recorded, no token needed.
export async function getPreviewRenderable(tenantId: string, id: string): Promise<RenderableProposal | null> {
  const { data: doc } = await admin().from('proposals').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!doc) return null
  const { data: lines } = await admin().from('sales_document_lines').select('*').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).order('sort_order')
  const contact = doc.contact_id ? (await admin().from('contacts').select('name, email, phone, address').eq('id', doc.contact_id).maybeSingle()).data : null
  const company = doc.company_id ? (await admin().from('companies').select('name').eq('id', doc.company_id).maybeSingle()).data : null
  const { data: sections } = await admin().from('proposal_sections').select('title, body, sort_order, visible').eq('tenant_id', tenantId).eq('proposal_id', id).order('sort_order')
  return assembleRenderable(tenantId, doc as Record<string, unknown>, (lines ?? []) as Record<string, unknown>[], contact, company, (sections ?? []) as Record<string, unknown>[])
}
