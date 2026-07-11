import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Save the Google review settings for the ACTIVE business. Operator-safe: writes ONLY to the validated
// active tenant (replaces the browser-side tenants.update which resolved to the operator's own tenant).
export async function PATCH(req: NextRequest) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!ctx.capabilities.canEditSettings) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if ('google_review_url' in body) updates.google_review_url = (body.google_review_url as string)?.trim() || null
  if ('review_automation_enabled' in body) updates.review_automation_enabled = !!body.review_automation_enabled
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const { error } = await createAdminClient().from('tenants').update(updates).eq('id', ctx.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
