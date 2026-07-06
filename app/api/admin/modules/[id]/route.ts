import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { enabledModulesOf } from '@/lib/modules'

// GET /api/admin/modules/[id] — one business's detail + its module change history.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const supabase = await createServiceClient()
  const { data: t, error } = await supabase
    .from('tenants')
    .select('id, user_id, business_name, email, phone, plan, created_at, enabled_modules')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Owner email from auth.
  let ownerEmail: string | null = t.email || null
  try {
    const { data: authUser } = await supabase.auth.admin.getUserById(t.user_id)
    ownerEmail = authUser?.user?.email || ownerEmail
  } catch { /* fall back to tenant email */ }

  const { data: audit } = await supabase
    .from('module_audit_log')
    .select('id, changed_by, before_modules, after_modules, added, removed, created_at')
    .eq('tenant_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({
    tenant: {
      id: t.id,
      business_name: t.business_name,
      owner_email: ownerEmail,
      phone: t.phone,
      plan: t.plan,
      status: t.plan === 'trial' ? 'trialing' : 'active',
      created_at: t.created_at,
      enabled_modules: enabledModulesOf(t),
    },
    audit: audit || [],
  })
}
