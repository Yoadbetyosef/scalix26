import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  // RLS ("Tenant conversations access") ensures the user can only update
  // conversations belonging to their own tenant.
  const { data, error } = await supabase
    .from('conversations')
    .update({ human_takeover: enabled })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  return NextResponse.json({ ok: true, human_takeover: enabled })
}
