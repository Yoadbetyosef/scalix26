import { QBO, QBO_AUTHORIZE_URL, QBO_TOKEN_URL, QBO_REVOKE_URL, QBO_SCOPE } from './config'

// Hand-rolled Intuit OAuth2 (authorization-code + refresh), no third-party SDK. Intuit authenticates the
// token/revoke calls with HTTP Basic (clientId:clientSecret).

export interface QboTokens { accessToken: string; refreshToken: string; expiresInSec: number; refreshExpiresInSec: number }

const basicAuth = () => 'Basic ' + Buffer.from(`${QBO.clientId}:${QBO.clientSecret}`).toString('base64')

// The consent screen URL the user is redirected to. `state` is our signed CSRF token.
export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: QBO.clientId,
    response_type: 'code',
    scope: QBO_SCOPE,
    redirect_uri: QBO.redirectUri,
    state,
  })
  return `${QBO_AUTHORIZE_URL}?${p.toString()}`
}

async function tokenRequest(body: Record<string, string>): Promise<QboTokens> {
  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`qbo_token_${res.status}: ${json.error_description || json.error || 'token request failed'}`)
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSec: Number(json.expires_in ?? 3600),
    refreshExpiresInSec: Number(json.x_refresh_token_expires_in ?? 8_726_400),
  }
}

export const exchangeCode = (code: string): Promise<QboTokens> =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: QBO.redirectUri })

export const refreshTokens = (refreshToken: string): Promise<QboTokens> =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })

// Best-effort token revocation on disconnect (Intuit invalidates the whole token family).
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch(QBO_REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: refreshToken }),
    })
  } catch { /* revocation is best-effort; local disconnect proceeds regardless */ }
}
