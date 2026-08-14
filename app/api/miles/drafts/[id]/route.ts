import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { byId, markSent, markHandled, unclaim } from '@/lib/miles/drafts'
import { deliverToConversation } from '@/lib/messaging/send'

// THE THREE ACTIONS, from inside the app. The same three arrive by link in the next stage.
//
//   send    — deliver the draft, as written or as edited, and record what actually went out
//   handle  — "I'll handle it": Miles stops replying on that thread at all
//
// There is no third endpoint for Edit. Editing IS sending, with a different body — a separate
// "save the edit" state would be a draft the owner has already decided about, sitting in the queue
// pretending to still need them.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { action, body } = await req.json().catch(() => ({ action: null, body: null }))
  const db = createAdminClient()

  const draft = await byId(db, tenantId, id)
  if (!draft) return NextResponse.json({ error: 'That draft is no longer here' }, { status: 404 })
  if (draft.status !== 'pending') {
    // Not an error the owner caused: they decided already, probably on another device.
    return NextResponse.json({ error: 'This one has already been decided', status: draft.status }, { status: 409 })
  }

  if (action === 'handle') {
    const out = await markHandled(db, tenantId, id, user.id)
    if (!out) return NextResponse.json({ error: 'This one has already been decided' }, { status: 409 })
    return NextResponse.json({ ok: true, status: 'handled' })
  }

  if (action !== 'send') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const edited = typeof body === 'string' ? body.trim() : ''
  const text = edited || draft.body
  if (!text.trim()) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 })
  if (!draft.conversation_id) {
    return NextResponse.json({ error: 'This draft has no conversation to reply to' }, { status: 400 })
  }

  // CLAIM FIRST, DELIVER SECOND.
  //
  // The failure that must never happen is sending twice — a second tap, a slow network, a link opened
  // on two devices. markSent is guarded on status='pending', so the claim is what makes those safe.
  // The cost is that a delivery failing AFTER the claim would leave a row marked sent that never went
  // out, so that case is reverted below and reported. Pending is the truthful state for a reply the
  // customer did not receive.
  const claimed = await markSent(db, tenantId, id, {
    decidedBy: user.id,
    sentBody: edited && edited !== draft.body ? edited : null,
  })
  if (!claimed) return NextResponse.json({ error: 'This one has already been decided' }, { status: 409 })

  const delivery = await deliverToConversation(tenantId, draft.conversation_id, text)
  if (!delivery.delivered) {
    await unclaim(db, tenantId, id)
    return NextResponse.json(
      { error: delivery.error || 'Could not send that — it is still waiting for you.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, status: 'sent', edited: !!(edited && edited !== draft.body) })
}
