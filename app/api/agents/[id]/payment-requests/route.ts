import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// List payment requests for an agent (owner-facing approval queue). Newest first.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id').eq('id', id).single()
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: tenant } = await admin.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = new URL(req.url).searchParams.get('status') // optional filter
  let q = admin.from('payment_requests')
    .select('id, status, kind, price_id, product_name, amount, currency, customer_email, customer_phone, channel, description, checkout_url, created_by, created_at, decided_at')
    .eq('ai_employee_id', id).order('created_at', { ascending: false }).limit(50)
  if (status) q = q.eq('status', status)
  const { data } = await q
  return NextResponse.json({ requests: data || [] })
}
