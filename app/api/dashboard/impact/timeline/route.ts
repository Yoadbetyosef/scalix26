import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getConversationTimeline } from '@/lib/dashboard/timeline'

// READ-ONLY per-conversation timeline. Tenant resolved from the authenticated user;
// the conversation must belong to that tenant (enforced in getConversationTimeline).
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversationId = req.nextUrl.searchParams.get('conversation') || ''
  if (!conversationId) return NextResponse.json({ error: 'conversation required' }, { status: 400 })

  // Active workspace (owner tenant, or the client tenant a WL partner is operating). getConversationTimeline
  // uses the admin client and enforces the conversation belongs to this tenant.
  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'no tenant' }, { status: 404 })

  try {
    const events = await getConversationTimeline(tenantId, conversationId)
    return NextResponse.json({ events })
  } catch (err) {
    console.error('[timeline] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed to load timeline' }, { status: 500 })
  }
}
