import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { runAIPipeline } from '@/lib/anthropic/pipeline'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, conversationId } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

  // Active workspace (owner tenant, or the client tenant a White Label partner is operating).
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  const tenant = { id: activeTenantId }

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
