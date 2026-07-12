import { NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { enforce } from '@/lib/ratelimit'
import { assertPartnerActive, BILLING_PAUSED_CODE, PAUSED_API_MESSAGE } from '@/lib/billing/gate'
import { mintAmyRealtimeToken } from '@/lib/billing/amy-realtime-token'

// Pre-flight for the Ask Amy REALTIME voice session (dashboard → amy-realtime-server → Deepgram Voice
// Agent). The browser MUST call this and get a token before the proxy will configure Deepgram. A
// paused/depleted White Label partner is blocked here (402) so no billable realtime session can start.
// Inert for direct Scalix tenants and while WL_BILLING_ENABLED is off (gate passes → token minted).
export async function POST() {
  const bctx = await requireActiveBusinessContext()
  if (!bctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limited = await enforce('ai_amy', `tenant:${bctx.tenantId}`)
  if (limited) return limited

  if (!(await assertPartnerActive({ tenantId: bctx.tenantId })).ok) {
    return NextResponse.json({ error: BILLING_PAUSED_CODE, message: PAUSED_API_MESSAGE }, { status: 402 })
  }
  // token is null until AMY_REALTIME_SECRET is configured — the proxy then runs unverified (rollout).
  return NextResponse.json({ ok: true, token: mintAmyRealtimeToken(bctx.tenantId) })
}
