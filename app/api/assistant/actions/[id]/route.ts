import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { executeAction } from '@/lib/assistant/execute'

// POST /api/assistant/actions/[id] — body { action: 'confirm' | 'cancel' }.
// confirm → execute the real backend action and record the true result.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const { data: tenant } = await db.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 404 })
  const { id } = await params

  let body: { action?: string }
  try { body = await req.json() } catch { body = {} }

  if (body.action === 'cancel') {
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('id', id).eq('tenant_id', tenant.id).eq('status', 'pending')
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }

  // Default: confirm + execute.
  const result = await executeAction(id, tenant.id, user.id)
  return NextResponse.json(result)
}
