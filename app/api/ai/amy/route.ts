import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { answerAsAmy } from '@/lib/amy/answer'
import { enforce } from '@/lib/ratelimit'
import { assertPartnerActive, BILLING_PAUSED_CODE, PAUSED_API_MESSAGE } from '@/lib/billing/gate'

// Amy as Chief of Staff — answers from THIS business's real data via the Business Context Layer.
// The tenant is the validated ACTIVE workspace (owner tenant, or the client tenant a White Label
// partner is operating) — never resolved from user_id — so Amy speaks for the business being operated.
export async function POST(req: NextRequest) {
  const bctx = await requireActiveBusinessContext()
  if (!bctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limited = await enforce('ai_amy', `tenant:${bctx.tenantId}`)
  if (limited) return limited

  // WL prepaid billing gate — the dashboard assistant is a billable LLM action; a paused/depleted
  // owning partner can't run it. Inert for direct Scalix tenants and while WL_BILLING_ENABLED is off.
  if (!(await assertPartnerActive({ tenantId: bctx.tenantId })).ok) {
    return NextResponse.json({ error: BILLING_PAUSED_CODE, message: PAUSED_API_MESSAGE }, { status: 402 })
  }

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants').select('id, business_name').eq('id', bctx.tenantId).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { message?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const { data: emp } = await admin
    .from('ai_employees').select('name').eq('tenant_id', tenant.id).eq('status', 'active').limit(1).maybeSingle()

  const text = await answerAsAmy({
    tenantId: tenant.id,
    question: message,
    employeeName: emp?.name || 'Amy',
    businessName: tenant.business_name || undefined,
  })

  // Emit as a stream so the existing client reader works unchanged.
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close() } }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}
