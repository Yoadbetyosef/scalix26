import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { sanitizeVariant } from '@/lib/studio/sanitize'

// PATCH /api/studio/variants/[vid] — update a variant.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { vid } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db
    .from('studio_variants')
    .update({ ...sanitizeVariant(body), updated_at: new Date().toISOString() })
    .eq('id', vid).eq('tenant_id', s.tenantId)
    .select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ variant: data })
}

// DELETE /api/studio/variants/[vid] — remove a variant.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { vid } = await params
  const db = createAdminClient()
  const { error } = await db.from('studio_variants').delete().eq('id', vid).eq('tenant_id', s.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
