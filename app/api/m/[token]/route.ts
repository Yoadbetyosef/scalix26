import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { byToken, applyDecision } from '@/lib/miles/decide'
import { enforce, clientIp } from '@/lib/ratelimit'

// DECIDING FROM THE LINK, with no session.
//
// The token in the URL is the sole credential — the owner is on a lock screen, not logged in. Same
// arrangement as /approval/[token] for order approvals, and the same discipline: the raw token is
// never logged, only its hash is stored, and the token identifies exactly one draft.
//
// The tenant is taken from the DRAFT the token resolves to, never from the request. There is nothing
// a caller can pass that changes whose conversation this replies to.

const STATUS: Record<string, number> = {
  not_found: 404, already: 409, no_conversation: 400, empty: 400, delivery: 502,
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // A public endpoint that sends messages: rate-limited by IP so a leaked or guessed link cannot be
  // hammered. The token's own 256 bits are the real gate.
  const limited = await enforce('webhook', `miles-decide:${clientIp(req)}`)
  if (limited) return limited

  const { token } = await params
  const { action, body } = await req.json().catch(() => ({ action: null, body: null }))
  if (action !== 'send' && action !== 'handle') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const db = createAdminClient()
  const draft = await byToken(db, token)
  // The same answer for a malformed token, an unknown one, and one whose draft has been deleted:
  // a valid-looking link should not be able to tell a stranger which of those it is.
  if (!draft) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })

  const out = await applyDecision(db, draft.tenant_id, draft.id, action, {
    // Not a user id: nobody signed in. What is recorded is HOW it was decided, which is the honest
    // answer and is what the inbox shows next to it.
    decidedBy: 'link',
    body: typeof body === 'string' ? body : null,
  })

  if (!out.ok) return NextResponse.json({ error: out.message }, { status: STATUS[out.code] ?? 400 })
  return NextResponse.json({ ok: true, status: out.status, edited: out.edited })
}
