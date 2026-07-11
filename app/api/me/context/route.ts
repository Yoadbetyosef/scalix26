import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext, getActiveWorkspace } from '@/lib/workspace'

// The active business context for client components (e.g. the notification bell binds realtime to the
// VALIDATED active tenant, never the operator's own). Returns only non-sensitive identifiers.
// Also records lightweight login lifecycle for White Label clients (first_login_at once; last_login_at
// throttled to ~6h) — this is the once-per-mount hook, so it never adds per-request write load.
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

  return NextResponse.json({ tenantId: ctx.tenantId, mode: ctx.mode })
}
