import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'

// Admin-only, read-only state for the Meta App Review demo page. Everything returned is REAL:
// the connected FB Page / IG account from `channels`, and the latest real inbound Messenger /
// Instagram messages from `conversations`/`messages`. Nothing is mocked.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 404 })
  const tid = tenant.id

  // Connected Meta assets
  const { data: channels } = await supabase
    .from('channels')
    .select('type, meta_page_id, credentials, status')
    .eq('tenant_id', tid)
    .in('type', ['facebook', 'instagram'])

  const fb = (channels || []).find((c) => c.type === 'facebook')
  const ig = (channels || []).find((c) => c.type === 'instagram')
  const cred = (c: typeof fb) => (c?.credentials as Record<string, string> | undefined) || {}
  const facebook = fb ? { pageName: cred(fb).page_name || null, pageId: fb.meta_page_id, status: fb.status } : null
  const instagram = ig ? { username: cred(ig).username || null, igId: ig.meta_page_id, linkedPageId: cred(ig).page_id || null, status: ig.status } : null

  // Latest inbound FB/IG conversations + their latest incoming message + the sender id to reply to
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, channel, contact_id, updated_at')
    .eq('tenant_id', tid)
    .in('channel', ['facebook', 'instagram'])
    .order('updated_at', { ascending: false })
    .limit(10)

  const convIds = (convs || []).map((c) => c.id)
  const contactIds = [...new Set((convs || []).map((c) => c.contact_id).filter(Boolean))] as string[]

  const [{ data: contacts }, { data: msgs }] = await Promise.all([
    contactIds.length
      ? supabase.from('contacts').select('id, phone, name').in('id', contactIds)
      : Promise.resolve({ data: [] as { id: string; phone: string | null; name: string | null }[] }),
    convIds.length
      ? supabase.from('messages').select('conversation_id, content, timestamp').in('conversation_id', convIds).eq('role', 'user').order('timestamp', { ascending: false })
      : Promise.resolve({ data: [] as { conversation_id: string; content: string; timestamp: string }[] }),
  ])

  const incoming = (convs || [])
    .map((c) => {
      const m = (msgs || []).find((x) => x.conversation_id === c.id)
      if (!m) return null
      const ct = (contacts || []).find((x) => x.id === c.contact_id)
      return {
        conversationId: c.id,
        channel: c.channel as 'facebook' | 'instagram',
        sender: ct?.name || ct?.phone || 'unknown',
        recipientId: ct?.phone || null, // PSID (Messenger) / IGSID (Instagram) — needed to reply
        text: m.content,
        timestamp: m.timestamp,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b!.timestamp).getTime() - new Date(a!.timestamp).getTime())

  return NextResponse.json({ facebook, instagram, incoming })
}
