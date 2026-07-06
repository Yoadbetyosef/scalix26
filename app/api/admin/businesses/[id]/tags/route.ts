import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'
import { ALLOWED_TAGS } from '@/lib/admin/tags'

// PUT /api/admin/businesses/[id]/tags — replace a business's tags.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canWrite(ctx.role)) return NextResponse.json({ error: 'Read-only role' }, { status: 403 })
  const { id } = await params

  let body: { tags?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!Array.isArray(body.tags)) return NextResponse.json({ error: 'tags[] required' }, { status: 400 })
  const allowed = ALLOWED_TAGS as readonly string[]
  const tags = Array.from(new Set(body.tags.filter((t): t is string => typeof t === 'string' && allowed.includes(t))))

  const admin = createAdminClient()
  const { data: before } = await admin.from('tenants').select('tags').eq('id', id).maybeSingle()
  const { error } = await admin.from('tenants').update({ tags }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, { action: 'tags.update', targetType: 'tenant', targetId: id, before: before?.tags ?? [], after: tags })
  return NextResponse.json({ tags })
}
