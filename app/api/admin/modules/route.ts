import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { ALL_MODULES, enabledModulesOf, isModuleKey } from '@/lib/modules'

// GET /api/admin/modules — list every business with its enabled modules.
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, business_name, plan, enabled_modules')
    .order('business_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tenants = (data || []).map((t) => ({
    id: t.id,
    business_name: t.business_name,
    plan: t.plan,
    enabled_modules: enabledModulesOf(t),
  }))
  return NextResponse.json({ tenants, allModules: ALL_MODULES })
}

// PATCH /api/admin/modules — set a single tenant's enabled modules.
// Body: { tenantId: string, enabled_modules: string[] }
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  // Only accept known module keys, de-duplicated.
  const clean = Array.from(new Set(enabled_modules.filter(isModuleKey)))

  // Admin client bypasses RLS for this server-only write to an RLS-locked table.
  const admin = createAdminClient()
  const { error } = await admin.from('tenants').update({ enabled_modules: clean }).eq('id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, enabled_modules: clean })
}
