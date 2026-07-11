import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Update one lead's status for the ACTIVE business (and stop any active drip when it leaves the funnel).
// Operator-safe: tenant comes ONLY from the validated active-workspace context; the row must belong to it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const status = typeof body.status === 'string' ? body.status : null
  if (!status || !['new', 'contacted', 'qualified', 'booked', 'dismissed', 'lost'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: lead } = await admin.from('leads').select('id, tenant_id').eq('id', id).maybeSingle()
  if (!lead || lead.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('leads').update({ status }).eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Stop any active drip for this lead when it's booked/dismissed/lost. The lead is already validated to
  // the active tenant, so lead_id is a sufficient (and schema-safe) scope. Best-effort.
  if (['booked', 'dismissed', 'lost'].includes(status)) {
    await admin.from('drip_campaigns').update({ status: 'stopped' }).eq('lead_id', id).eq('status', 'active').then(undefined, () => {})
  }
  return NextResponse.json({ ok: true })
}
