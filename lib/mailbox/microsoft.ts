import type { InboundMessage, MailAccount, MailProvider, OAuthTokens, ReplyInput } from './types'

// Microsoft 365 / Outlook.com provider via Microsoft Graph. Mirrors googleProvider:
// OAuth (authorization code + refresh), incremental inbox read via the Graph delta
// query (cursor stored in the existing history_id column), native reply, mark-as-read.
const SCOPES = ['offline_access', 'openid', 'email', 'Mail.Read', 'Mail.Send', 'User.Read']
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH = 'https://graph.microsoft.com/v1.0'

function clientId() {
  const id = process.env.MICROSOFT_CLIENT_ID
  if (!id) throw new Error('MICROSOFT_CLIENT_ID is not set')
  return id
}
function clientSecret() {
  const s = process.env.MICROSOFT_CLIENT_SECRET
  if (!s) throw new Error('MICROSOFT_CLIENT_SECRET is not set')
  return s
}

// Graph fetch: absolute URLs (delta/nextLink/deltaLink) pass through; paths are prefixed.
async function graph(accessToken: string, urlOrPath: string, init?: RequestInit) {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH}${urlOrPath}`
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { name?: string; address?: string } }
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
  receivedDateTime?: string
  internetMessageId?: string
  internetMessageHeaders?: { name: string; value: string }[]
}

const MSG_SELECT = 'id,conversationId,subject,from,body,bodyPreview,receivedDateTime,internetMessageId,internetMessageHeaders'

function toInbound(m: GraphMessage): InboundMessage {
  const address = m.from?.emailAddress?.address || ''
  const name = m.from?.emailAddress?.name || ''
  const rawFrom = name ? `${name} <${address}>` : address
  const headers: Record<string, string> = {}
  for (const h of m.internetMessageHeaders || []) headers[h.name.toLowerCase()] = h.value
  const isHtml = (m.body?.contentType || '').toLowerCase() === 'html'
  const body = m.body?.content ? (isHtml ? stripHtml(m.body.content) : m.body.content) : (m.bodyPreview || '')
  return {
    providerMessageId: m.id,
    threadId: m.conversationId || m.id,
    from: rawFrom,
    fromEmail: address.toLowerCase(),
    subject: m.subject || '',
    body,
    rfcMessageId: m.internetMessageId || headers['message-id'] || '',
    internalDateMs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : null,
    headers,
  }
}

// Drain a delta collection by id, following @odata.nextLink pages; return the ids and
// the final @odata.deltaLink (the cursor for the next poll). $select=id keeps it light.
async function drainDelta(accessToken: string, startUrl: string): Promise<{ ids: string[]; deltaLink: string | null }> {
  const ids: string[] = []
  let url: string | null = startUrl
  let deltaLink: string | null = null
  let guard = 0
  while (url && guard++ < 50) {
    const res = await graph(accessToken, url)
    if (!res.ok) throw new Error(`graph delta failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { value?: { id?: string; '@removed'?: unknown }[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }
    for (const it of data.value || []) if (it.id && !it['@removed']) ids.push(it.id)
    if (data['@odata.deltaLink']) { deltaLink = data['@odata.deltaLink']; break }
    url = data['@odata.nextLink'] || null
  }
  return { ids, deltaLink }
}

export const microsoftProvider: MailProvider = {
  name: 'microsoft',

  getAuthUrl({ state, redirectUri }) {
    const url = new URL(`${AUTHORITY}/authorize`)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', SCOPES.join(' '))
    url.searchParams.set('prompt', 'consent') // ensure a refresh token + explicit consent
    url.searchParams.set('state', state)
    return url.toString()
  },

  async exchangeCode({ code, redirectUri }) {
    const res = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: SCOPES.join(' '),
      }),
    })
    if (!res.ok) throw new Error(`microsoft token exchange failed: ${res.status} ${await res.text()}`)
    const data = await res.json()

    // Identify the mailbox (work/school: userPrincipalName; personal: mail).
    const meRes = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${data.access_token}` } })
    if (!meRes.ok) throw new Error(`graph /me failed: ${meRes.status} ${await meRes.text()}`)
    const me = await meRes.json()
    const email = String(me.mail || me.userPrincipalName || '').toLowerCase()

    // Establish the inbox delta cursor at connect time so the first poll only sees NEW
    // mail. Best-effort: a null cursor just triggers the recent-unread fallback once.
    let historyId: string | null = null
    try {
      const { deltaLink } = await drainDelta(data.access_token, `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id`)
      historyId = deltaLink
    } catch (err) {
      console.warn('[microsoft] initial delta cursor failed (fallback on first poll):', err instanceof Error ? err.message : err)
    }

    const tokens: OAuthTokens = {
      email,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      scopes: data.scope || SCOPES.join(' '),
      historyId,
    }
    return tokens
  },

  async refresh(refreshToken) {
    const res = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPES.join(' '),
      }),
    })
    if (!res.ok) throw new Error(`microsoft token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 }
  },

  async listNewMessages(account) {
    const ids = new Set<string>()
    let newHistoryId: string | null = account.historyId
    let usedDelta = false

    if (account.historyId) {
      try {
        const { ids: dIds, deltaLink } = await drainDelta(account.accessToken, account.historyId)
        usedDelta = true
        for (const id of dIds) ids.add(id)
        if (deltaLink) newHistoryId = deltaLink
      } catch (err) {
        console.warn('[microsoft] delta failed — falling back to recent-unread scan:', err instanceof Error ? err.message : err)
      }
    }
    if (!usedDelta) {
      const path = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent('isRead eq false')}&$orderby=${encodeURIComponent('receivedDateTime desc')}&$top=25&$select=id`
      const res = await graph(account.accessToken, path)
      if (res.ok) {
        const data = (await res.json()) as { value?: { id?: string }[] }
        for (const m of data.value || []) if (m.id) ids.add(m.id)
      }
      // (Re)establish the delta cursor for the next poll.
      try {
        const { deltaLink } = await drainDelta(account.accessToken, `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id`)
        if (deltaLink) newHistoryId = deltaLink
      } catch { /* keep prior cursor */ }
    }

    const messages: InboundMessage[] = []
    for (const id of ids) {
      const res = await graph(account.accessToken, `/me/messages/${id}?$select=${MSG_SELECT}`)
      if (!res.ok) continue
      messages.push(toInbound((await res.json()) as GraphMessage))
    }
    return { messages, newHistoryId }
  },

  async sendReply(account, reply: ReplyInput) {
    // Graph blocks standard In-Reply-To/References via internetMessageHeaders (only x-*
    // custom headers are allowed). For proper threading, use Graph's native reply action
    // when we can locate the original message by its Internet Message-ID; otherwise send
    // a fresh message. Either way it goes out from the owner's own M365/Outlook address.
    let graphId: string | null = null
    if (reply.inReplyTo) {
      const q = encodeURIComponent(`internetMessageId eq '${reply.inReplyTo.replace(/'/g, "''")}'`)
      const look = await graph(account.accessToken, `/me/messages?$filter=${q}&$select=id&$top=1`)
      if (look.ok) {
        const d = (await look.json()) as { value?: { id?: string }[] }
        graphId = d.value?.[0]?.id || null
      }
    }
    console.log(`[microsoft] sendReply | from=${account.emailAddress} | to=${reply.to} | threaded=${!!graphId} | bodyLen=${reply.body.length}`)

    if (graphId) {
      const res = await graph(account.accessToken, `/me/messages/${graphId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: { toRecipients: [{ emailAddress: { address: reply.to } }], body: { contentType: 'Text', content: reply.body } } }),
      })
      if (res.ok) return
      console.warn(`[microsoft] reply action failed (${res.status}) — falling back to sendMail:`, await res.text())
    }

    const res = await graph(account.accessToken, `/me/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: reply.subject,
          body: { contentType: 'Text', content: reply.body },
          toRecipients: [{ emailAddress: { address: reply.to } }],
        },
        saveToSentItems: true,
      }),
    })
    if (!res.ok) throw new Error(`graph sendMail failed: ${res.status} ${await res.text()}`)
  },

  async markProcessed(account, providerMessageId) {
    await graph(account.accessToken, `/me/messages/${providerMessageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true }),
    })
  },
}
