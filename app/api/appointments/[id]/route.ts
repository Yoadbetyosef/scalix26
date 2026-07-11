import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Update one appointment (mark completed / skip review) for the ACTIVE business. Operator-safe: the
// tenant comes ONLY from the validated active-workspace context, and the row must belong to it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string' && ['completed', 'cancelled', 'confirmed', 'scheduled'].includes(body.status)) updates.status = body.status
  if (typeof body.skip_review === 'boolean') updates.skip_review = body.skip_review
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const admin = createAdminClient()
  const { data: appt } = await admin.from('appointments').select('id, tenant_id').eq('id', id).maybeSingle()
  if (!appt || appt.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('appointments').update(updates).eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
