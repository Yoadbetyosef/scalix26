import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canManageModules } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'
import { ALL_MODULES, enabledModulesOf, isModuleKey } from '@/lib/modules'

// GET /api/admin/modules — every business with its modules, owner email, plan, status, date.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = createAdminClient() // service-role: list all businesses (bypass RLS)
  const { data, error } = await supabase
    .from('tenants')
    .select('id, user_id, business_name, email, plan, created_at, enabled_modules')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Owner emails from auth (fallback to the tenant email column).
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const emailById = Object.fromEntries((authData?.users || []).map((u) => [u.id, u.email]))

  const tenants = (data || []).map((t) => ({
    id: t.id,
    business_name: t.business_name,
    owner_email: emailById[t.user_id] || t.email || null,
    plan: t.plan,
    status: t.plan === 'trial' ? 'trialing' : 'active',
    created_at: t.created_at,
    enabled_modules: enabledModulesOf(t),
  }))
  return NextResponse.json({ tenants, allModules: ALL_MODULES })
}

// PATCH /api/admin/modules — set a single tenant's enabled modules + write an audit entry.
// Body: { tenantId: string, enabled_modules: string[] }
export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageModules(ctx.role)) return NextResponse.json({ error: 'Not permitted for your role' }, { status: 403 })
  const changedBy = ctx.email

  let body: { tenantId?: string; enabled_modules?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { tenantId, enabled_modules } = body
  if (!tenantId || !Array.isArray(enabled_modules)) {
    return NextResponse.json({ error: 'tenantId and enabled_modules[] required' }, { status: 400 })
  }
  const after = Array.from(new Set(enabled_modules.filter(isModuleKey)))

  const admin = createAdminClient()

  // Snapshot the current value for the audit diff.
  const { data: current } = await admin.from('tenants').select('enabled_modules').eq('id', tenantId).maybeSingle()
  const before = enabledModulesOf(current)

  const { error } = await admin.from('tenants').update({ enabled_modules: after }).eq('id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const added = after.filter((m) => !before.includes(m))
  const removed = before.filter((m) => !after.includes(m))
  // Only log actual changes.
  if (added.length || removed.length) {
    await admin.from('module_audit_log').insert({
      tenant_id: tenantId,
      changed_by: changedBy,
      before_modules: before,
      after_modules: after,
      added,
      removed,
    })
    await logAdminAction(changedBy, {
      action: 'module.update',
      targetType: 'tenant',
      targetId: tenantId,
      before: { modules: before },
      after: { modules: after, added, removed },
    })
  }

  return NextResponse.json({ ok: true, enabled_modules: after })
}
