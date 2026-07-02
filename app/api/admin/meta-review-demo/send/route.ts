import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'

// Admin-only, isolated test-send for the Meta App Review screencast. Sends a REAL message to a
// connected Messenger / Instagram conversation via the Meta Graph API using the stored page/IG
// access token, and returns Meta's real message_id + recipient_id as delivery proof. It does NOT
// write to the inbox tables — it only proves the outbound Send API works end-to-end.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const channel = body.channel as string
  const recipientId = (body.recipientId as string || '').trim()
  const text = (body.text as string || '').trim()
  if (channel !== 'facebook' && channel !== 'instagram') return NextResponse.json({ error: 'channel must be facebook or instagram' }, { status: 400 })
  if (!recipientId) return NextResponse.json({ error: 'recipientId (PSID/IGSID) required — receive a message first' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const { data: ch } = await supabase
    .from('channels')
    .select('credentials, status')
    .eq('tenant_id', tenant.id)
    .eq('type', channel)
    .eq('status', 'connected')
    .maybeSingle()
  const token = (ch?.credentials as Record<string, string> | undefined)?.access_token
  if (!token) return NextResponse.json({ error: `no connected ${channel} channel / access token` }, { status: 400 })

  // Real Meta Graph API send (same endpoint the production inbox uses).
  const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, access_token: token }),
  })
  const raw = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(raw) } catch { /* keep raw */ }

  if (!res.ok) {
    const err = (json.error as { message?: string })?.message || raw.slice(0, 300)
    return NextResponse.json({ ok: false, status: res.status, error: err }, { status: 200 })
  }

  return NextResponse.json({
    ok: true,
    status: res.status,
    messageId: json.message_id ?? null,
    recipientId: json.recipient_id ?? recipientId,
    text,
    sentAt: new Date().toISOString(),
  })
}
