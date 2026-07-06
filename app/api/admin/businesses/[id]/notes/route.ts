import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'

// POST /api/admin/businesses/[id]/notes — add an internal note (admin-only).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canWrite(ctx.role)) return NextResponse.json({ error: 'Read-only role' }, { status: 403 })
  const { id } = await params

  let body: { body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = (body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Empty note' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('admin_notes')
    .insert({ tenant_id: id, admin_email: ctx.email, body: text })
    .select('id, admin_email, body, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, { action: 'note.add', targetType: 'tenant', targetId: id, after: { body: text } })
  return NextResponse.json({ note: data })
}
