import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'
import { getProvider } from '@/lib/mailbox'
import { saveAccount } from '@/lib/mailbox/account'

// Mirrors /api/auth/meta/callback: verify HMAC state + CSRF nonce + session user,
// exchange the code for tokens, store them encrypted, redirect back to the agent.
export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=cancelled`)
  }

  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)
  const payloadB64 = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  const expectedSig = createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET!).update(payloadB64).digest('hex')
  if (sig !== expectedSig) return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)
  }

  const cookieNonce = req.cookies.get('google_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    return NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const clearNonce = (res: NextResponse) => { res.cookies.set('google_oauth_nonce', '', { maxAge: 0, path: '/' }); return res }

  try {
    const redirectUri = `${baseUrl}/api/auth/google/callback`
    const tokens = await getProvider('google').exchangeCode({ code, redirectUri })

    if (!tokens.refreshToken) {
      // Without a refresh token we can't poll long-term — Google omits it if the
      // user previously consented. prompt=consent should prevent this; surface it.
      console.warn('[google/callback] no refresh token returned for', tokens.email)
    }

    // Confirm the agent belongs to this user's tenant before saving.
    const service = await createServiceClient()
    const { data: agent } = await service.from('ai_employees').select('id, tenant_id').eq('id', payload.agentId).single()
    if (!agent) return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`))
    const { data: tenant } = await service.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
    if (!tenant) return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees?google_error=invalid_state`))

    await saveAccount({ tenantId: agent.tenant_id, aiEmployeeId: payload.agentId, provider: 'google', tokens })
    console.log('[google/callback] connected', tokens.email, 'for agent', payload.agentId)

    return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?google_connected=true`))
  } catch (err) {
    console.error('[google/callback] connect failed:', err instanceof Error ? err.message : err)
    return clearNonce(NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?google_error=token_failed`))
  }
}
