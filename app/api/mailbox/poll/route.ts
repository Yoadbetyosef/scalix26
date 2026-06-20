import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cronAuthorized } from '@/lib/reviews'
import { getProvider } from '@/lib/mailbox'
import { getValidAccount, listConnectedAccounts } from '@/lib/mailbox/account'
import { generateEmailReply } from '@/lib/email/reply'
import { isNonCustomerEmail, domainsFromEmails } from '@/lib/email/is-non-customer'
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
    .select('id, name, system_prompt, business_name, email_auto_reply, email_handoff_after_first_reply')
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
    let convTakeover = false
    const { data: existing } = await supabase.from('conversations').select('id, human_takeover')
      .eq('tenant_id', account.tenantId).eq('contact_id', contactId).eq('channel', 'email').eq('status', 'open')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (existing) {
      convId = existing.id
      convTakeover = existing.human_takeover === true
      await supabase.from('conversations').update({ summary: msg.subject, updated_at: nowIso }).eq('id', convId)
    } else {
      const { data: created } = await supabase.from('conversations')
        .insert({ tenant_id: account.tenantId, ai_employee_id: agent?.id ?? null, contact_id: contactId, channel: 'email', status: 'open', summary: msg.subject })
        .select('id').single()
      convId = created?.id ?? null
    }
    if (!convId) { skipped++; continue }

    // Persist the inbound message (with external_id so re-polls dedupe).
    const { data: inMsg } = await supabase.from('messages').insert({
      conversation_id: convId, tenant_id: account.tenantId, role: 'user',
      content: msg.body || '(no body)', channel: 'email', external_id: msg.providerMessageId,
    }).select('id').single()
    // Best-effort: store threading metadata for manual replies (non-fatal pre-migration).
    if (inMsg) {
      const { error: thErr } = await supabase.from('messages')
        .update({ email_message_id: msg.rfcMessageId || null, email_thread_id: msg.threadId || null }).eq('id', inMsg.id)
      if (thErr) console.warn('[mailbox-poll] threading meta not stored (run add_message_email_threading.sql?):', thErr.message)
    }

    // 2a. Human has taken over this email thread — never let the AI reply again.
    // Store the inbound (done above), mark it processed, and move on.
    if (convTakeover) {
      console.log('[mailbox-poll] human_takeover active for conv', convId, '— storing only')
      await provider.markProcessed(account, msg.providerMessageId)
      skipped++
      continue
    }

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

    // Structured non-customer gate: never auto-reply to automated/notification/platform/
    // self/own-domain senders. The inbound message is already stored above (stays in the
    // Inbox); we just don't reply or treat it as a customer interaction.
    const ncReason = isNonCustomerEmail(msg.fromEmail, domainsFromEmails([account.emailAddress])).reason
    if (ncReason) {
      console.log('[mailbox-poll] non-customer sender, not auto-replying:', msg.fromEmail, ncReason)
      await provider.markProcessed(account, msg.providerMessageId)
      skipped++
      continue
    }

    try {
      console.log('[mailbox-poll] generating reply for', msg.fromEmail)
      const reply = await generateEmailReply({
        tenantId: account.tenantId, agent, tenantBusinessName: tenant?.business_name ?? null,
        emailText: msg.body || '', subject: msg.subject,
      })
      console.log('[mailbox-poll] reply generated, length', reply.length)
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
      // 2b. Acknowledge-then-handoff: after this one reply, hand the thread to the
      // human so every further inbound email hits the human_takeover branch (2a).
      if (agent.email_handoff_after_first_reply) {
        await supabase.from('conversations').update({ human_takeover: true }).eq('id', convId)
        console.log('[mailbox-poll] handoff-after-first-reply: conv', convId, '→ human_takeover')
      }
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
