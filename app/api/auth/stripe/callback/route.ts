import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'
import { exchangeConnectCode, saveConnectedAccount } from '@/lib/stripe/connect'
import { resolveOwnerTenantId } from '@/lib/calendar/store'
import { requestBaseUrl } from '@/lib/request-url'

// Stripe Connect OAuth callback. Verifies HMAC state + CSRF nonce + session, exchanges
// the code for the tenant's connected account id (acct_…), stores it. Mirrors the
// Gmail/Outlook callbacks.
export async function GET(req: NextRequest) {
  const baseUrl = requestBaseUrl(req)
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  const back = (agentId: string, q: string) => agentId ? `${baseUrl}/ai-employees/${agentId}?${q}` : `${baseUrl}/ai-employees?${q}`

  if (oauthError || !code || !state) {
    return NextResponse.redirect(back('', 'stripe_error=cancelled'))
  }

  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) return NextResponse.redirect(back('', 'stripe_error=invalid_state'))
  const payloadB64 = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  const expectedSig = createHmac('sha256', process.env.STRIPE_SECRET_KEY!).update(payloadB64).digest('hex')
  if (sig !== expectedSig) return NextResponse.redirect(back('', 'stripe_error=invalid_state'))

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return NextResponse.redirect(back('', 'stripe_error=invalid_state'))
  }

  const cookieNonce = req.cookies.get('sconnect_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    return NextResponse.redirect(back(payload.agentId, 'stripe_error=invalid_state'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const clearNonce = (res: NextResponse) => { res.cookies.set('sconnect_oauth_nonce', '', { maxAge: 0, path: '/' }); return res }

  try {
    const tenantId = await resolveOwnerTenantId(user.id)
    if (!tenantId) return clearNonce(NextResponse.redirect(back(payload.agentId, 'stripe_error=no_tenant')))

    const accountId = await exchangeConnectCode(code)
    await saveConnectedAccount(tenantId, accountId)
    console.log('[stripe/callback] connected account', accountId, 'for tenant', tenantId)

    return clearNonce(NextResponse.redirect(back(payload.agentId, 'stripe_connected=true')))
  } catch (err) {
    console.error('[stripe/callback] connect FAILED:', err instanceof Error ? err.message : err)
    return clearNonce(NextResponse.redirect(back(payload.agentId, 'stripe_error=token_failed')))
  }
}
