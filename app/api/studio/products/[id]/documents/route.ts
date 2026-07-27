import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { isStudioDocType, variantPrice, variantTitle, type StudioDocLineItem } from '@/lib/studio/types'

// GET /api/studio/products/[id]/documents — documents issued from this product (newest first).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = createAdminClient()
  const { data, error } = await db.from('studio_documents').select('*')
    .eq('tenant_id', s.tenantId).eq('product_id', id).order('created_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data || [] })
}

// POST /api/studio/products/[id]/documents — create a production order / quote / invoice.
// The client sends { type, party_name, party_email, notes, items:[{ref,qty}] }. We rebuild every line
// from the DB (authoritative name/fabric/price) so prices can't be tampered with client-side.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const type = body.type
  if (!isStudioDocType(type)) return NextResponse.json({ error: 'Bad type' }, { status: 400 })

  const db = createAdminClient()
  const { data: product } = await db.from('studio_products').select('*').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: variants } = await db.from('studio_variants').select('*').eq('product_id', id).eq('tenant_id', s.tenantId)

  // Requested { ref, qty } — ref is 'product' or a variant id. Skip qty <= 0.
  const requested = Array.isArray(body.items) ? body.items : []
  const qtyOf = (ref: string): number => {
    const hit = requested.find((r) => r && typeof r === 'object' && (r as { ref?: string }).ref === ref)
    const q = Math.trunc(Number((hit as { qty?: unknown })?.qty))
    return Number.isFinite(q) && q > 0 ? q : 0
  }

  const productFabric = product.fabric_name ? [product.fabric_family, product.fabric_name].filter(Boolean).join(' · ') : null
  const lines: StudioDocLineItem[] = []
  const pq = qtyOf('product')
  if (pq > 0) lines.push({ ref: 'product', name: product.name, fabric: productFabric, sku: null, qty: pq, unit_price: product.base_price, image: product.photos?.[0] || null, desc: product.description })
  for (const v of variants || []) {
    const q = qtyOf(v.id)
    if (q > 0) lines.push({
      ref: v.id, name: variantTitle(v),
      fabric: v.fabric_name ? [v.fabric_family, v.fabric_name].filter(Boolean).join(' · ') : null,
      sku: v.sku, qty: q, unit_price: variantPrice(product, v),
      image: v.photos?.[0] || product.photos?.[0] || null, desc: v.description,
    })
  }
  if (lines.length === 0) return NextResponse.json({ error: 'Pick at least one item with a quantity' }, { status: 400 })

  const subtotal = Math.round(lines.reduce((sum, l) => sum + (l.unit_price || 0) * l.qty, 0) * 100) / 100

  // Snapshot branding (logo/terms) + validity from the tenant's doc settings, so the document stays fixed.
  const { data: settings } = await db.from('studio_doc_settings').select('*').eq('tenant_id', s.tenantId).maybeSingle()
  const validityDays = settings?.validity_days ?? 30
  const validUntil = new Date(Date.now() + validityDays * 86400000).toISOString().slice(0, 10)

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const { data, error } = await db.from('studio_documents').insert({
    tenant_id: s.tenantId, product_id: id, type,
    party_name: str(body.party_name), party_email: str(body.party_email), client_phone: str(body.client_phone), notes: str(body.notes),
    line_items: lines, subtotal, created_by: s.email,
    logo_url: settings?.logo_url || null, accent_color: settings?.accent_color || null,
    terms: settings?.terms || null, valid_until: validUntil,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ document: data })
}
