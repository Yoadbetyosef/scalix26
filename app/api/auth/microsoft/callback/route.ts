import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'
import { getProvider } from '@/lib/mailbox'
import { saveAccount } from '@/lib/mailbox/account'
import { requestBaseUrl } from '@/lib/request-url'

// Mirror of /api/auth/google/callback for Microsoft Graph. Reuses the existing
// ?google_connected / ?google_error query params so the edit screen's generic
// "Inbox connected!" toast keeps working without UI changes (the single-box UI that
// routes Microsoft here is a later step).
export async function GET(req: NextRequest) {
  const baseUrl = requestBaseUrl(req)
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError || !code || !state) {
    console.warn('[microsoft/callback] missing code/state or oauth error:', oauthError, '| code?', !!code, '| state?', !!state)
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=cancelled`)
  }

  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) { console.warn('[microsoft/callback] invalid_state: no dot in state'); return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`) }
  const payloadB64 = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  const expectedSig = createHmac('sha256', process.env.MICROSOFT_CLIENT_SECRET!).update(payloadB64).digest('hex')
  if (sig !== expectedSig) { console.warn('[microsoft/callback] invalid_state: HMAC mismatch'); return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`) }

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    console.warn('[microsoft/callback] invalid_state: payload parse failed')
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)
  }

  const cookieNonce = req.cookies.get('ms_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    console.warn('[microsoft/callback] invalid_state: nonce mismatch | cookie?', !!cookieNonce)
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) {
    console.warn('[microsoft/callback] session mismatch | user?', !!user)
    return NextResponse.redirect(`${baseUrl}/auth/login`)
  }

  const clearNonce = (res: NextResponse) => { res.cookies.set('ms_oauth_nonce', '', { maxAge: 0, path: '/' }); return res }

  try {
    const redirectUri = `${baseUrl}/api/auth/microsoft/callback`
    const tokens = await getProvider('microsoft').exchangeCode({ code, redirectUri })
    console.log('[microsoft/callback] token exchange OK | email', tokens.email, '| refresh?', !!tokens.refreshToken, '| cursor?', !!tokens.historyId)
    if (!tokens.refreshToken) console.warn('[microsoft/callback] no refresh token returned for', tokens.email)

    // Confirm the agent belongs to this user's tenant before saving.
    const service = await createServiceClient()
    const { data: agent } = await service.from('ai_employees').select('id, tenant_id').eq('id', payload.agentId).single()
    if (!agent) { console.warn('[microsoft/callback] agent not found', payload.agentId); return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)) }
    const { data: tenant } = await service.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
    if (!tenant) { console.warn('[microsoft/callback] tenant/owner mismatch for agent', payload.agentId); return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)) }

    await saveAccount({ tenantId: agent.tenant_id, aiEmployeeId: payload.agentId, provider: 'microsoft', tokens })
    console.log('[microsoft/callback] connected', tokens.email, 'for agent', payload.agentId)

    return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?google_connected=true`))
  } catch (err) {
    const limit = err instanceof Error && err.message === 'mailbox_limit'
    console.error('[microsoft/callback] connect FAILED:', err instanceof Error ? err.message : err)
    return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?google_error=${limit ? 'mailbox_limit' : 'token_failed'}`))
  }
}
