import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext, getActiveWorkspace } from '@/lib/workspace'
import { getTenantEnabledModules } from '@/lib/tenant'

// The active business context for client components (e.g. the notification bell binds realtime to the
// VALIDATED active tenant, never the operator's own). Returns only non-sensitive identifiers.
// Also records lightweight login lifecycle for White Label clients (first_login_at once; last_login_at
// throttled to ~6h) — this is the once-per-mount hook, so it never adds per-request write load.
//
// ── IT ALSO CARRIES THE SHELL'S OWN FACTS, AND THAT IS THE POINT ──────────────────────────────────
//
// The sidebar used to read `tenants` straight from the browser with `.eq('user_id', user.id)`, which
// is the one-tenant-one-user assumption wearing a different hat: a team member owns no tenant, so
// that query returned nothing and she'd have seen a shell with no business name, no plan, and — worse
// — every module hidden. Serving those fields from here fixes it for her AND removes three
// RLS-dependent browser reads (tenants, module_flags, ai_employees) from the critical path, because
// this route resolves through requireActiveBusinessContext like everything else on the server.
export async function GET() {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ tenantId: null, mode: 'owner' }, { status: 200 })

  // Track login only for a customer signed into their OWN White Label business (not partner impersonation).
  if (ctx.mode === 'owner') {
    const ws = await getActiveWorkspace()
    if (ws.whiteLabelPartnerId) {
      const db = createAdminClient()
      const { data: t } = await db.from('tenants').select('first_login_at, last_login_at').eq('id', ctx.tenantId).maybeSingle()
      const now = Date.now()
      const stale = !t?.last_login_at || (now - new Date(t.last_login_at).getTime()) > 6 * 3600 * 1000
      if (stale) {
        const patch: Record<string, string> = { last_login_at: new Date().toISOString() }
        if (!t?.first_login_at) patch.first_login_at = patch.last_login_at
        await db.from('tenants').update(patch).eq('id', ctx.tenantId).then(undefined, () => {})
      }
    }
  }

  const db = createAdminClient()
  const [{ data: tenant }, modules, { data: employees }] = await Promise.all([
    db.from('tenants').select('business_name, plan, trial_ends_at').eq('id', ctx.tenantId).maybeSingle(),
    getTenantEnabledModules(),
    db.from('ai_employees').select('is_active').eq('tenant_id', ctx.tenantId),
  ])

  return NextResponse.json({
    tenantId: ctx.tenantId,
    mode: ctx.mode,
    role: ctx.role,
    capabilities: ctx.capabilities,
    businessName: tenant?.business_name ?? null,
    // Billing belongs to the owner. A staff member is told nothing about the plan or the trial clock,
    // so the shell simply has no upgrade nag to render for her.
    plan: ctx.capabilities.canEditBilling ? (tenant?.plan ?? null) : null,
    trialEndsAt: ctx.capabilities.canEditBilling ? (tenant?.trial_ends_at ?? null) : null,
    enabledModules: modules,
    aiOn: !!(employees || []).some((e) => (e as { is_active?: boolean }).is_active !== false),
  })
}
