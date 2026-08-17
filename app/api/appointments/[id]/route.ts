import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Update one appointment for the ACTIVE business. Operator-safe: the tenant comes ONLY from the
// validated active-workspace context, and the row must belong to it.
//
// ── ADDRESS AND LINK, ADDED FOR THE AMBER ROW ───────────────────────────────────────────────────
//
// The agenda has always named the gap on a row that is missing the one thing its kind needs — an
// address for an on_site job, a link for a video call — and promoted the fix to the first action.
// That action rendered DISABLED, because this route accepted `status` and `skip_review` and nothing
// else. A row that names a problem and offers a button that cannot solve it is worse than a row that
// says nothing, so either this accepted them or the button had to go.
//
// Blank CLEARS, deliberately. "We had the wrong address and now we have none" is a real state, it is
// what the agenda already renders as amber, and refusing to express it would mean the only way to
// correct a wrong address is to type a different wrong one.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string' && ['completed', 'cancelled', 'confirmed', 'scheduled'].includes(body.status)) updates.status = body.status
  if (typeof body.skip_review === 'boolean') updates.skip_review = body.skip_review
  // Trimmed, and an empty string becomes null rather than ''. The agenda tests `r.address ? …`, so a
  // blank string would read as present and the row would go quiet while showing nothing.
  if (typeof body.address === 'string') updates.address = body.address.trim().slice(0, 500) || null
  if (typeof body.join_url === 'string') {
    const u = body.join_url.trim()
    // A link that is not a link would render as a dead "Join" button on the customer's row. Same
    // rule the booking tool applies to what the AI hears.
    if (!u) updates.join_url = null
    else if (/^https?:\/\/\S+$/i.test(u)) updates.join_url = u.slice(0, 1000)
    else return NextResponse.json({ error: 'That does not look like a link. It should start with http:// or https://' }, { status: 400 })
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const admin = createAdminClient()
  const { data: appt } = await admin.from('appointments').select('id, tenant_id').eq('id', id).maybeSingle()
  if (!appt || appt.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('appointments').update(updates).eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
