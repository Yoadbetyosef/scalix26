import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, conversationId } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  try {
    const result = await runAIPipeline({
      tenantId: tenant.id,
      channelType: 'sms',
      from: 'test-user',
      messageContent: message,
      conversationId,
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'AI pipeline failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
