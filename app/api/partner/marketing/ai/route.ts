import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { runCreativeAction, runLandingAction, CREATIVE_ACTIONS } from '@/lib/partner/marketing-ai'

// AI Creative Studio + Landing optimization. Language-only (never touches money/counts). The client
// sends the already-composed text so we don't duplicate the creative-field parser server-side.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.kind === 'creative') {
      if (!CREATIVE_ACTIONS[b.action]) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
      const p = b.payload || {}
      const out = await runCreativeAction(b.action, { type: p.type || 'ad_copy', title: p.title || '', text: p.text || '', platform: p.platform })
      return NextResponse.json({ result: out })
    }
    if (b.kind === 'landing') {
      const p = b.payload || {}
      const out = await runLandingAction(b.action, { headline: p.headline || '', subhead: p.subhead, cta_text: p.cta_text || '', extra: p.extra })
      return NextResponse.json({ result: out })
    }
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'AI request failed — try again.' }, { status: 500 })
  }
}
