import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { hexColor } from '@/lib/studio/types'

// Document branding (logo, colour, terms, quote validity) for Estimates and Quotes generated from orders.
//
// It reads and writes the SAME studio_doc_settings row as /api/studio/doc-settings — branding belongs to
// the business, not to a module, so a logo uploaded in either place shows up on every document. This
// route exists because that one is gated on the `studio` module, which a tenant running only Orders
// (TG jewellers, for one) doesn't have: without it the logo could never be set at all.

export async function GET() {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const db = createAdminClient()
  const { data } = await db.from('studio_doc_settings').select('*').eq('tenant_id', a.tenantId).maybeSingle()
  return NextResponse.json({ settings: data || { tenant_id: a.tenantId, logo_url: null, accent_color: null, terms: null, validity_days: 30 } })
}

export async function PUT(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const days = Math.trunc(Number(body.validity_days))
  const db = createAdminClient()
  const { data, error } = await db.from('studio_doc_settings').upsert({
    tenant_id: a.tenantId,
    logo_url: str(body.logo_url),
    accent_color: hexColor(body.accent_color),
    terms: str(body.terms),
    validity_days: Number.isFinite(days) && days > 0 ? days : 30,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
