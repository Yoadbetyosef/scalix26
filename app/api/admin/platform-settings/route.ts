import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'
import { getPlatformSettings, clearPlatformSettingsCache } from '@/lib/platform-settings'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ settings: await getPlatformSettings() })
}

// PATCH { key, value } — upsert a single setting. Numbers stored as numeric jsonb.
export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  const { error } = await createAdminClient().from('platform_settings').upsert({ key: b.key, value: b.value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  clearPlatformSettingsCache()
  await logAdminAction(ctx.email, { action: 'platform_setting.update', targetType: 'setting', targetId: b.key, after: { value: b.value } })
  return NextResponse.json({ success: true })
}
