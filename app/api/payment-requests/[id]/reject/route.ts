import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Owner rejects a pending payment request — nothing is charged, no link is created.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: pr } = await admin.from('payment_requests').select('id, tenant_id, status').eq('id', id).maybeSingle()
  if (!pr) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: tenant } = await admin.from('tenants').select('id').eq('id', pr.tenant_id).eq('user_id', user.id).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (pr.status !== 'pending') return NextResponse.json({ error: `Request is already ${pr.status}` }, { status: 409 })

  await admin.from('payment_requests').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true })
}
