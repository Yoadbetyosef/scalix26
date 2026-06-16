import type { InboundMessage, MailAccount, MailProvider, OAuthTokens, ReplyInput } from './types'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
]

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function clientId() {
  const id = process.env.GOOGLE_CLIENT_ID
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set')
  return id
}
function clientSecret() {
  const s = process.env.GOOGLE_CLIENT_SECRET
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET is not set')
  return s
}

function header(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/)
  return (m ? m[1] : raw).trim().toLowerCase()
}

function b64urlDecode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}
function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// RFC 2047 encode a header value if it contains non-ASCII (e.g. Hebrew subjects).
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// Walk a Gmail payload tree and pull the best text body (prefer text/plain).
function extractBody(payload: GmailPayload | undefined): string {
  if (!payload) return ''
  const plain = findPart(payload, 'text/plain')
  if (plain?.body?.data) return b64urlDecode(plain.body.data)
  const html = findPart(payload, 'text/html')
  if (html?.body?.data) return b64urlDecode(html.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (payload.body?.data) return b64urlDecode(payload.body.data)
  return ''
}
function findPart(p: GmailPayload, mime: string): GmailPayload | undefined {
  if (p.mimeType === mime && p.body?.data) return p
  for (const part of p.parts || []) {
    const found = findPart(part, mime)
    if (found) return found
  }
  return undefined
}

interface GmailPayload {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string }
  parts?: GmailPayload[]
}

async function gapi(account: MailAccount, path: string, init?: RequestInit) {
  const res = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return res
}

export const googleProvider: MailProvider = {
  name: 'google',

  getAuthUrl({ state, redirectUri }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(' '))
    url.searchParams.set('access_type', 'offline') // get a refresh token
    url.searchParams.set('prompt', 'consent') // force refresh token on re-consent
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('state', state)
    return url.toString()
  },

  async exchangeCode({ code, redirectUri }) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`)
    const data = await res.json()

    // Identify the mailbox + capture the starting historyId.
    const profRes = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${data.access_token}` } })
    if (!profRes.ok) throw new Error(`gmail profile failed: ${profRes.status} ${await profRes.text()}`)
    const profile = await profRes.json()

    const tokens: OAuthTokens = {
      email: String(profile.emailAddress || '').toLowerCase(),
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      scopes: data.scope || SCOPES.join(' '),
      historyId: profile.historyId ? String(profile.historyId) : null,
    }
    return tokens
  },

  async refresh(refreshToken) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId(),
        client_secret: clientSecret(),
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 }
  },

  async listNewMessages(account) {
    const ids = new Set<string>()

    // Prefer the incremental history cursor; fall back to a recent-unread scan.
    let usedHistory = false
    if (account.historyId) {
      const res = await gapi(account, `/history?startHistoryId=${account.historyId}&historyTypes=messageAdded&labelId=INBOX`)
      if (res.ok) {
        usedHistory = true
        const data = await res.json()
        for (const h of data.history || []) {
          for (const m of h.messagesAdded || []) if (m.message?.id) ids.add(m.message.id)
        }
      } else if (res.status !== 404) {
        throw new Error(`gmail history failed: ${res.status} ${await res.text()}`)
      }
      // 404 => cursor too old; fall through to the recent scan.
    }
    if (!usedHistory) {
      const res = await gapi(account, `/messages?q=${encodeURIComponent('is:unread newer_than:1d in:inbox')}&maxResults=25`)
      if (res.ok) {
        const data = await res.json()
        for (const m of data.messages || []) if (m.id) ids.add(m.id)
      }
    }

    const messages: InboundMessage[] = []
    for (const id of ids) {
      const res = await gapi(account, `/messages/${id}?format=full`)
      if (!res.ok) continue
      const msg = await res.json()
      const h = (msg.payload?.headers || []) as { name: string; value: string }[]
      const from = header(h, 'From')
      const headers: Record<string, string> = {}
      for (const item of h) headers[item.name.toLowerCase()] = item.value
      messages.push({
        providerMessageId: id,
        threadId: msg.threadId || id,
        from,
        fromEmail: parseEmail(from),
        subject: header(h, 'Subject'),
        body: extractBody(msg.payload),
        rfcMessageId: header(h, 'Message-ID') || header(h, 'Message-Id'),
        internalDateMs: msg.internalDate ? Number(msg.internalDate) : null,
        headers,
      })
    }

    // Latest cursor for the next poll.
    let newHistoryId: string | null = account.historyId
    const prof = await gapi(account, '/profile')
    if (prof.ok) {
      const p = await prof.json()
      if (p.historyId) newHistoryId = String(p.historyId)
    }
    return { messages, newHistoryId }
  },

  async sendReply(account, reply: ReplyInput) {
    const bodyB64 = Buffer.from(reply.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
    // Build the HEADERS only (dropping the optional threading headers when absent),
    // then join with the MANDATORY blank line + body. Do NOT .filter() the whole
    // message — that strips the header/body separator and yields an empty body.
    const headers = [
      `From: ${account.emailAddress}`,
      `To: ${reply.to}`,
      `Subject: ${encodeHeaderValue(reply.subject)}`,
      reply.inReplyTo ? `In-Reply-To: ${reply.inReplyTo}` : '',
      reply.references ? `References: ${reply.references}` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].filter(Boolean)
    const mime = `${headers.join('\r\n')}\r\n\r\n${bodyB64}`
    console.log(`[google] sendReply | from=${account.emailAddress} | to=${reply.to} | bodyLen=${reply.body.length}`)

    const body: { raw: string; threadId?: string } = { raw: b64urlEncode(Buffer.from(mime, 'utf8')) }
    if (reply.threadId) body.threadId = reply.threadId // omit when unknown (still threads via References)
    const res = await gapi(account, '/messages/send', { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`gmail send failed: ${res.status} ${await res.text()}`)
  },

  async markProcessed(account, providerMessageId) {
    await gapi(account, `/messages/${providerMessageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })
  },
}
