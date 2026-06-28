import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { answerAsAmy } from '@/lib/amy/answer'

// Amy as Chief of Staff — answers from THIS business's real data via the Business
// Context Layer. Auth-gated; the tenant is resolved server-side from the session, so
// Amy can only ever read the signed-in owner's own workspace.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants').select('id, business_name').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
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
