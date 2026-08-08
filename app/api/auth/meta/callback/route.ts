import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { createHmac } from 'crypto'
import { claimMetaPages } from '@/lib/meta/connect'

interface MetaPage {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string; name: string; username: string }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const metaError = req.nextUrl.searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (metaError || !code || !state) {
    return NextResponse.redirect(`${baseUrl}/ai-employees?meta_error=cancelled`)
  }

  // Verify HMAC signature on state
  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) return NextResponse.redirect(`${baseUrl}/ai-employees?meta_error=invalid_state`)

  const payloadB64 = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  const expectedSig = createHmac('sha256', process.env.META_APP_SECRET!).update(payloadB64).digest('hex')

  if (sig !== expectedSig) {
    return NextResponse.redirect(`${baseUrl}/ai-employees?meta_error=invalid_state`)
  }

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return NextResponse.redirect(`${baseUrl}/ai-employees?meta_error=invalid_state`)
  }

  // Verify CSRF nonce
  const cookieNonce = req.cookies.get('meta_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    return NextResponse.redirect(`${baseUrl}/ai-employees?meta_error=invalid_state`)
  }

  // Verify user session matches
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) {
    return NextResponse.redirect(`${baseUrl}/auth/login`)
  }

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const redirectUri = `${baseUrl}/api/auth/meta/callback`

  // Exchange code for user access token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  )
  if (!tokenRes.ok) {
    console.error('[meta/callback] Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?meta_error=token_failed`)
  }
  const { access_token: userToken } = await tokenRes.json()

  // Fetch the Pages this token can reach, with their long-lived Page access tokens.
  //
  // ── UNVERIFIED UNDER A SYSTEM-USER TOKEN ────────────────────────────────────────────────────────
  //
  // The token exchange itself is unchanged by Login for Business — same /oauth/access_token endpoint,
  // same { access_token } response — so nothing above this line needed touching. THIS call is the one
  // that might behave differently: the configuration issues a SYSTEM-USER token, tied to the client's
  // business portfolio rather than to a person, and Meta's Login-for-Business documentation does not
  // state whether /me/accounts enumerates Pages for one. The documented alternatives for a system user
  // are the business-scoped edges (/{business-id}/client_pages, /{system-user-id}/assigned_pages).
  //
  // It is left as /me/accounts because that is what this integration has always used and switching it
  // on an untested assumption would trade a known unknown for an unknown one. What IS changed is the
  // diagnostics: an empty list no longer looks like "this person administers no Pages", because under
  // a system-user token it could equally mean "this edge is the wrong one". The first real connect
  // settles it, and the log line below says which of the two happened.
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}&fields=id,name,access_token,instagram_business_account{id,name,username}`
  )
  if (!pagesRes.ok) {
    console.error('[meta/callback] Pages fetch failed:', await pagesRes.text())
    return NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?meta_error=pages_failed`)
  }
  const pagesData = await pagesRes.json()
  const pages: MetaPage[] = pagesData.data || []

  if (pages.length === 0) {
    // Loud, and specific about the ambiguity, because a silent "no pages" is how this class of bug
    // hides: the tenant sees a plausible message and stops, and nobody learns that the token was fine
    // and the edge was wrong.
    console.error(
      '[meta/callback] /me/accounts returned ZERO pages. Under a system-user token this may mean the ' +
      'edge is wrong rather than that the business has no Pages — check /{business-id}/client_pages. ' +
      'Raw response:', JSON.stringify(pagesData).slice(0, 800),
    )
    return NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?meta_error=no_pages`)
  }

  // Clear CSRF nonce cookie
  const clearNonce = (res: NextResponse) => {
    res.cookies.set('meta_oauth_nonce', '', { maxAge: 0, path: '/' })
    return res
  }

  // Single page — auto-connect without picker
  if (pages.length === 1) {
    const { error: connectErr } = await connectPage(payload.agentId, pages[0])
    const back = connectErr ? 'meta_error=page_in_use' : 'meta_connected=true'
    return clearNonce(
      NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}?${back}`)
    )
  }

  // Multiple pages — pass to picker via short-lived cookie
  const pagesJson = JSON.stringify(
    pages.map(p => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      instagram: p.instagram_business_account || null,
    }))
  )

  const res = NextResponse.redirect(`${baseUrl}/ai-employees/${payload.agentId}/connect-meta`)
  clearNonce(res)
  res.cookies.set('meta_pending_pages', pagesJson, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 300,
    path: '/',
    sameSite: 'lax',
  })
  return res
}

export async function connectPage(agentId: string, page: MetaPage): Promise<{ error: string | null }> {
  // Admin client (operator-safe): createServiceClient would RLS-scope the agent read + claim write to the
  // partner's own tenant and miss/deny a WL client agent.
  const supabase = createAdminClient()

  // Resolve the tenant from the AGENT and validate it against the active workspace
  // (owner tenant, or the client tenant a White Label partner switched into) — never
  // from the raw user, which would mis-route a client's page to the partner's own tenant.
  const { data: agent } = await supabase.from('ai_employees').select('id, tenant_id').eq('id', agentId).maybeSingle()
  if (!agent) return { error: 'Account not found.' }
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || agent.tenant_id !== activeTenantId) return { error: 'Account not found.' }
  const tenant = { id: agent.tenant_id }

  // Build the page(s) to claim: the FB page, plus its linked IG account if present.
  const pages: { type: 'facebook' | 'instagram'; metaPageId: string; credentials: Record<string, string> }[] = [
    { type: 'facebook', metaPageId: page.id, credentials: { access_token: page.access_token, page_name: page.name } },
  ]
  if (page.instagram_business_account) {
    pages.push({
      type: 'instagram',
      metaPageId: page.instagram_business_account.id,
      credentials: { access_token: page.access_token, page_id: page.id, username: page.instagram_business_account.username },
    })
  }

  // Uniqueness-enforced claim (cross-tenant block, same-tenant move, 23505 guard).
  const { error } = await claimMetaPages(supabase, { tenantId: tenant.id, agentId, pages })
  if (error) return { error }

  // Subscribe the page to webhook events so Messenger messages are received.
  await fetch(
    `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${page.access_token}`,
    { method: 'POST' }
  ).catch(err => console.error('[connectPage] webhook subscription failed:', err))

  return { error: null }
}
