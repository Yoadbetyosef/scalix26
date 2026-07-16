// QuickBooks Online (QBO) integration config — all values come from env so the same code runs against
// a sandbox company (development) and a production company. When creds are absent the integration is
// simply "not configured" and the UI disables Connect (no crash), mirroring the email/Resend guard.

export type QboEnvironment = 'sandbox' | 'production'

export const QBO = {
  clientId: process.env.QBO_CLIENT_ID || '',
  clientSecret: process.env.QBO_CLIENT_SECRET || '',
  redirectUri: process.env.QBO_REDIRECT_URI || '',
  environment: (process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox') as QboEnvironment,
}

export const qboConfigured = (): boolean => !!(QBO.clientId && QBO.clientSecret && QBO.redirectUri)

// Intuit OAuth2 endpoints (same for both environments).
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'

// API base differs by environment; realm-scoped paths hang off this.
export const qboApiBase = (env: QboEnvironment): string =>
  env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'
