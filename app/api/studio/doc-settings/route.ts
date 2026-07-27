import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { hexColor } from '@/lib/studio/types'

// GET /api/studio/doc-settings — the tenant's document branding (logo, terms, validity).
export async function GET() {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data } = await db.from('studio_doc_settings').select('*').eq('tenant_id', s.tenantId).maybeSingle()
  return NextResponse.json({ settings: data || { tenant_id: s.tenantId, logo_url: null, accent_color: null, terms: null, validity_days: 30 } })
}

// PUT /api/studio/doc-settings — upsert the tenant's document branding.
export async function PUT(req: NextRequest) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const days = Math.trunc(Number(body.validity_days))
  const db = createAdminClient()
  const { data, error } = await db.from('studio_doc_settings').upsert({
    tenant_id: s.tenantId,
    logo_url: str(body.logo_url),
    accent_color: hexColor(body.accent_color),
    terms: str(body.terms),
    validity_days: Number.isFinite(days) && days > 0 ? days : 30,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
