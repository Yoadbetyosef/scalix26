import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { applyDecision } from '@/lib/miles/decide'
import { v2Allowed } from '@/lib/v2/access'

// THE THREE ACTIONS, from inside the app. The same three arrive by link at /api/m/[token].
//
//   send    — deliver the draft, as written or as edited, and record what actually went out
//   handle  — "I'll handle it": Miles stops replying on that thread at all
//
// There is no third endpoint for Edit. Editing IS sending, with a different body — a separate
// "save the edit" state would be a draft the owner has already decided about, sitting in the queue
// pretending to still need them.
//
// The decision itself lives in lib/miles/decide.ts, shared with the token route, so the rule that
// matters — claim first, deliver second, never send twice — has one implementation.

const STATUS: Record<string, number> = {
  not_found: 404, already: 409, no_conversation: 400, empty: 400, delivery: 502,
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // /v2-ONLY, so it carries /v2's gate. A layout does not cover a route handler, and the inbox that
  // calls this is the only caller from inside the app — the SAME three decisions also arrive by link
  // at /api/m/[token], which is public by design and gated by the token instead.
  if (!v2Allowed(tenantId, user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, body } = await req.json().catch(() => ({ action: null, body: null }))
  if (action !== 'send' && action !== 'handle') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const out = await applyDecision(createAdminClient(), tenantId, id, action, {
    decidedBy: user.id,
    body: typeof body === 'string' ? body : null,
  })

  if (!out.ok) return NextResponse.json({ error: out.message }, { status: STATUS[out.code] ?? 400 })
  return NextResponse.json({ ok: true, status: out.status, edited: out.edited })
}
