import { NextResponse } from 'next/server'
import { getAdminContext, canManageSecurity, type AdminContext } from '@/lib/admin/rbac'
import { enforce } from '@/lib/ratelimit'
import { createAdminClient } from '@/lib/supabase/server'
import { platformAdminSyncAllowed } from '@/lib/billing/platform-fee'

// Shared authorization gate for every admin MANUAL platform-fee action (sync / cancel / expire-grace).
// One definition so the three endpoints can't drift apart on security:
//   • super-admin only,  • rate-limited per admin,  • Preview-gated (never a prod force-action by accident),
//   • the partner must exist,  • the ONLY browser input trusted is the partnerId in the path.
// Returns the resolved admin + partner on success, or a NextResponse to return immediately on failure.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PlatformAdminOk { ctx: AdminContext; partner: { id: string; company_name: string | null } }

export async function requirePlatformAdmin(partnerId: string): Promise<PlatformAdminOk | NextResponse> {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageSecurity(ctx.role)) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 })

  const flood = await enforce('admin_platform_sync', `platform_admin:${ctx.email}`)
  if (flood) return flood

  if (!platformAdminSyncAllowed()) {
    return NextResponse.json({ error: 'Manual platform actions are not available in this environment' }, { status: 403 })
  }
  if (!UUID_RE.test(partnerId)) return NextResponse.json({ error: 'Invalid partner id' }, { status: 400 })

  const { data: partner } = await createAdminClient()
    .from('partners').select('id, company_name').eq('id', partnerId).maybeSingle()
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return { ctx, partner }
}
