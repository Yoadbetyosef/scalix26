import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canManageSecurity, ROLES, type AdminRole } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'

const ROLE_KEYS = ROLES.map((r) => r.key) as string[]
const SUPER_OWNER = 'yoadbetyosef@gmail.com' // hardcoded super-admin; cannot be removed/demoted

// GET /api/admin/team — list admin team members (any admin can view).
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data, error } = await db.from('admin_users').select('id, email, role, created_at').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data || [], roles: ROLES, me: ctx.email })
}

// POST /api/admin/team — add or update a member's role (Super Admin only).
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageSecurity(ctx.role)) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 })

  let body: { email?: string; role?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const email = (body.email || '').trim().toLowerCase()
  const role = body.role as AdminRole
  if (!email || !email.includes('@') || !ROLE_KEYS.includes(role)) {
    return NextResponse.json({ error: 'Valid email + role required' }, { status: 400 })
  }
  if (email === SUPER_OWNER && role !== 'super_admin') {
    return NextResponse.json({ error: 'The platform owner must remain Super Admin' }, { status: 400 })
  }

  const db = createAdminClient()
  const { error } = await db.from('admin_users').upsert({ email, role }, { onConflict: 'email' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, { action: 'team.set_role', targetType: 'admin_user', targetLabel: email, after: { role } })
  return NextResponse.json({ ok: true, email, role })
}

// DELETE /api/admin/team?email=... — remove a member (Super Admin only).
export async function DELETE(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageSecurity(ctx.role)) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 })

  const email = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (email === SUPER_OWNER) return NextResponse.json({ error: 'Cannot remove the platform owner' }, { status: 400 })
  if (email === ctx.email) return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db.from('admin_users').delete().eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, { action: 'team.remove', targetType: 'admin_user', targetLabel: email })
  return NextResponse.json({ ok: true })
}
