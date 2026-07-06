import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canManageModules } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'
import { getModuleFlags } from '@/lib/admin/module-flags'
import { MODULES, MODULE_STATES, isModuleKey, type ModuleState } from '@/lib/modules'

const STATE_KEYS = MODULE_STATES.map((s) => s.key) as string[]

// GET /api/admin/feature-flags — the global lifecycle state of every module.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const flags = await getModuleFlags()
  return NextResponse.json({
    modules: MODULES.map((m) => ({ key: m.key, label: m.label, description: m.description, state: flags[m.key] })),
    states: MODULE_STATES,
  })
}

// PATCH /api/admin/feature-flags — set one module's global state.
export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageModules(ctx.role)) return NextResponse.json({ error: 'Not permitted for your role' }, { status: 403 })

  let body: { module?: string; state?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isModuleKey(body.module) || !body.state || !STATE_KEYS.includes(body.state)) {
    return NextResponse.json({ error: 'module + valid state required' }, { status: 400 })
  }
  const module = body.module
  const state = body.state as ModuleState

  const admin = createAdminClient()
  const { data: before } = await admin.from('module_flags').select('state').eq('module', module).maybeSingle()
  const { error } = await admin.from('module_flags').upsert({ module, state, updated_by: ctx.email, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, {
    action: 'feature_flag.update',
    targetType: 'module',
    targetLabel: module,
    before: { state: before?.state ?? 'enabled' },
    after: { state },
  })
  return NextResponse.json({ ok: true, module, state })
}
