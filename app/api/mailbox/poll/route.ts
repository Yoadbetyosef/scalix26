import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cronAuthorized } from '@/lib/reviews'
import { getProvider } from '@/lib/mailbox'
import { getValidAccount, listConnectedAccounts } from '@/lib/mailbox/account'
import { generateEmailReply } from '@/lib/email/reply'
import type { InboundMessage, MailAccount } from '@/lib/mailbox/types'

// Loop prevention: only reply to a real, human, inbound customer email.
function isAutomatedOrSelf(msg: InboundMessage, selfEmail: string): string | null {
  const from = msg.fromEmail
  if (!from) return 'no-from'
  if (from === selfEmail.toLowerCase()) return 'self'
  if (/(^|[.@])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce)([.@+]|$)/i.test(from)) return 'automated-sender'
  if (msg.headers['auto-submitted'] && msg.headers['auto-submitted'].toLowerCase() !== 'no') return 'auto-submitted'
  if (msg.headers['list-id'] || msg.headers['list-unsubscribe']) return 'mailing-list'
  if (msg.headers['precedence'] && /bulk|list|junk/i.test(msg.headers['precedence'])) return 'bulk'
  return null
}

async function pollAccount(account: MailAccount): Promise<{ replied: number; skipped: number }> {
  const supabase = await createServiceClient()
  const provider = getProvider(account.provider)
  let replied = 0
  let skipped = 0

  const { messages, newHistoryId } = await provider.listNewMessages(account)
  console.log(`[mailbox-poll] ${account.emailAddress}: ${messages.length} candidate(s)`)

  // The agent that owns this connection drives the reply (same prompt/KB everywhere).
  const { data: agent } = await supabase.from('ai_employees')
    .select('id, name, system_prompt, business_name, email_auto_reply')
    .eq('id', account.aiEmployeeId || '').maybeSingle()
  const { data: tenant } = await supabase.from('tenants').select('business_name').eq('id', account.tenantId).maybeSingle()

  for (const msg of messages) {
    // Baseline guard: only reply to mail that arrived AFTER the inbox was connected.
    // Anything older is ignored entirely — not replied to, not marked, just skipped.
    if (msg.internalDateMs !== null && msg.internalDateMs < account.baselineMs) {
      console.log(`[mailbox-poll] skip ${msg.providerMessageId} (pre-existing: arrived ${new Date(msg.internalDateMs).toISOString()} < baseline ${new Date(account.baselineMs).toISOString()})`)
      skipped++; continue
    }

    const reason = isAutomatedOrSelf(msg, account.emailAddress)
    if (reason) { console.log(`[mailbox-poll] skip ${msg.providerMessageId} (${reason})`); skipped++; continue }

    // Dedupe: never handle the same provider message twice across polls.
    const { data: dup } = await supabase.from('messages').select('id')
      .eq('tenant_id', account.tenantId).eq('external_id', msg.providerMessageId).maybeSingle()
    if (dup) { skipped++; continue }

    // Contact (by email) + open email conversation, mirroring the Resend path.
    let contactId: string | null = null
    const { data: c } = await supabase.from('contacts').select('id')
      .eq('tenant_id', account.tenantId).eq('email', msg.fromEmail).maybeSingle()
    if (c) contactId = c.id
    else {
      const { data: nc } = await supabase.from('contacts')
        .insert({ tenant_id: account.tenantId, email: msg.fromEmail, channel: 'email' }).select('id').single()
      contactId = nc?.id ?? null
    }

    const nowIso = new Date().toISOString()
    let convId: string | null = null
    const { data: existing } = await supabase.from('conversations').select('id')
      .eq('tenant_id', account.tenantId).eq('contact_id', contactId).eq('channel', 'email').eq('status', 'open')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (existing) {
      convId = existing.id
      await supabase.from('conversations').update({ summary: msg.subject, updated_at: nowIso }).eq('id', convId)
    } else {
      const { data: created } = await supabase.from('conversations')
        .insert({ tenant_id: account.tenantId, ai_employee_id: agent?.id ?? null, contact_id: contactId, channel: 'email', status: 'open', summary: msg.subject })
        .select('id').single()
      convId = created?.id ?? null
    }
    if (!convId) { skipped++; continue }

    // Persist the inbound message (with external_id so re-polls dedupe).
    await supabase.from('messages').insert({
      conversation_id: convId, tenant_id: account.tenantId, role: 'user',
      content: msg.body || '(no body)', channel: 'email', external_id: msg.providerMessageId,
    })

    if (!agent) {
      console.warn('[mailbox-poll] no agent for tenant ' + account.tenantId + ', skipping auto-reply')
      await provider.markProcessed(account, msg.providerMessageId)
      skipped++
      continue
    }
    if (agent.email_auto_reply === false) {
      console.log('[mailbox-poll] auto-reply OFF for agent', agent.id, '— leaving unread')
      skipped++
      continue
    }

    try {
      console.log('[mailbox-poll] generating reply for', msg.fromEmail)
      const reply = await generateEmailReply({
        tenantId: account.tenantId, agent, tenantBusinessName: tenant?.business_name ?? null,
        emailText: msg.body || '', subject: msg.subject,
      })
      const subject = msg.subject?.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject || 'your message'}`
      console.log(`[mailbox-poll] sending reply | transport=${provider.name}-api | from=${account.emailAddress} | to=${msg.fromEmail}`)
      await provider.sendReply(account, {
        to: msg.fromEmail, subject, body: reply,
        threadId: msg.threadId, inReplyTo: msg.rfcMessageId, references: msg.rfcMessageId,
      })
      await provider.markProcessed(account, msg.providerMessageId)
      await supabase.from('messages').insert({
        conversation_id: convId, tenant_id: account.tenantId, role: 'assistant', content: reply, channel: 'email',
      })
      console.log(`[mailbox-poll] reply SENT to ${msg.fromEmail} | transport=${provider.name}-api | from=${account.emailAddress}`)
      replied++
    } catch (err) {
      console.error('[mailbox-poll] reply failed for', msg.fromEmail, ':', err instanceof Error ? err.message : err)
      skipped++
    }
  }

  await supabase.from('connected_email_accounts')
    .update({ history_id: newHistoryId, last_polled_at: new Date().toISOString() }).eq('id', account.id)

  return { replied, skipped }
}

async function run(): Promise<NextResponse> {
  const accounts = await listConnectedAccounts()
  console.log(`[mailbox-poll] ${accounts.length} connected account(s)`)
  let replied = 0
  let skipped = 0
  let errored = 0

  for (const row of accounts) {
    const account = await getValidAccount(row) // refreshes; null => flagged 'error'
    if (!account) { errored++; continue } // skip error accounts, keep going
    try {
      const r = await pollAccount(account)
      replied += r.replied
      skipped += r.skipped
    } catch (err) {
      console.error('[mailbox-poll] account failed', row.email_address, err instanceof Error ? err.message : err)
      errored++
    }
  }

  return NextResponse.json({ ok: true, accounts: accounts.length, replied, skipped, errored })
}

export async function GET(req: NextRequest) {
  console.log('[mailbox-poll] hit (GET)')
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return run()
}
export async function POST(req: NextRequest) {
  console.log('[mailbox-poll] hit (POST)')
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return run()
}
