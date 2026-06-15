// Provider-agnostic mailbox layer. Google (Gmail) is implemented now;
// Microsoft 365 (Graph) can be added later by implementing this same interface.

export type MailProviderName = 'google' | 'microsoft'

export interface OAuthTokens {
  email: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number // epoch ms
  scopes: string
  historyId: string | null // starting cursor (Gmail); null for providers without one
}

// A real inbound email, normalized across providers.
export interface InboundMessage {
  providerMessageId: string // provider's message id — used for dedupe
  threadId: string
  from: string // raw From header
  fromEmail: string // parsed, lowercased address
  subject: string
  body: string // plain text
  rfcMessageId: string // the Message-ID header — used for In-Reply-To/References
  internalDateMs: number | null // when the message arrived (epoch ms) — baseline guard
  headers: Record<string, string> // lowercased header name -> value
}

// A live account with a valid (refreshed) access token, ready for API calls.
export interface MailAccount {
  id: string
  tenantId: string
  aiEmployeeId: string | null
  provider: MailProviderName
  emailAddress: string
  accessToken: string
  historyId: string | null
  baselineMs: number // connection moment — never process mail older than this
}

export interface ReplyInput {
  to: string
  subject: string
  body: string
  threadId: string
  inReplyTo: string
  references: string
}

export interface MailProvider {
  name: MailProviderName
  getAuthUrl(opts: { state: string; redirectUri: string }): string
  exchangeCode(opts: { code: string; redirectUri: string }): Promise<OAuthTokens>
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>
  // New inbound messages since the account's stored cursor, plus the new cursor.
  listNewMessages(account: MailAccount): Promise<{ messages: InboundMessage[]; newHistoryId: string | null }>
  sendReply(account: MailAccount, reply: ReplyInput): Promise<void>
  markProcessed(account: MailAccount, providerMessageId: string): Promise<void>
}
