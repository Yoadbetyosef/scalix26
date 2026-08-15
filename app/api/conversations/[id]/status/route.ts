import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { recapAfterResponse } from '@/lib/conversations/recap'

// Set a conversation's status (open/resolved/closed) for the ACTIVE business. Operator-safe: tenant
// comes ONLY from the validated active-workspace context; the conversation must belong to it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const status = typeof body.status === 'string' ? body.status : null
  if (!status || !['open', 'resolved', 'closed'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const admin = createAdminClient()
  const { data: conv } = await admin.from('conversations').select('id, tenant_id').eq('id', id).maybeSingle()
  if (!conv || conv.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('conversations').update({ status }).eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // The other completion point. Not on 'open' — reopening a thread is the opposite of finishing it,
  // and writeRecap only claims a row that has none, so resolve → reopen → resolve still costs once.
  if (status === 'resolved' || status === 'closed') recapAfterResponse(id, ctx.tenantId)

  return NextResponse.json({ ok: true })
}
