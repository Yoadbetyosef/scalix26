import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'

// Toggle human takeover for a conversation. When enabled, the AI stops
// responding and a human handles the conversation manually.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enabled } = await req.json().catch(() => ({ enabled: undefined }))
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
  }

  // Authorize against the active workspace (owner tenant, or the validated client tenant a White
  // Label partner switched into). The write goes ONLY to a conversation in that tenant.
  const activeTenantId = await getActiveTenantId()
  const admin = createAdminClient()
  const { data: conv } = await admin.from('conversations').select('id, tenant_id').eq('id', id).maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!activeTenantId || conv.tenant_id !== activeTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin.from('conversations').update({ human_takeover: enabled }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, human_takeover: enabled })
}
