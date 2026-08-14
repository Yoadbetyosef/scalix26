import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSMS } from '@/lib/twilio/client'
import { sendEmail } from '@/lib/email/send'
import { generateApprovalToken } from '@/lib/orders/approval-token'
import type { HeldDraft } from './drafts'
import { smsBody, emailBody } from './message'

// TELLING THE OWNER — with the reply IN THE MESSAGE, not behind a link.
//
// "You have a draft waiting, open the app" is the version of this feature that fails: response time
// collapses to however long it takes someone to find their password, and a draft that takes two
// minutes to read is not approved from a bus stop. So the full text travels in the body of the SMS
// and the email, and the link exists only to carry the decision back.
//
// There is no push infrastructure in this product — no service worker, no VAPID keys, no device
// tokens, no app. This IS the notification path, and it is deliberately built from what exists:
// Twilio, Resend, and the tokenised-link pattern app/approval/[token] already uses.
//
// NO QUIET HOURS. A draft that arrives at 11pm is announced at 11pm. The brief is explicit, and the
// reason is the same as everywhere else here: nothing decides on the owner's behalf.

/** Where the owner is reached. Same resolution the appointment confirmations use. */
export interface Owner {
  phone: string | null
  email: string | null
  businessName: string | null
}

export async function ownerOf(db: SupabaseClient, tenantId: string): Promise<Owner> {
  const { data: tenant } = await db
    .from('tenants').select('phone, email, business_name').eq('id', tenantId).maybeSingle()

  let phone: string | null = tenant?.phone ?? null
  if (!phone) {
    // The forwarding number is where calls already go, so it is where a person already is.
    const { data: agent } = await db
      .from('ai_employees').select('forward_to_phone').eq('tenant_id', tenantId)
      .not('forward_to_phone', 'is', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
    phone = agent?.forward_to_phone ?? null
  }
  return { phone, email: tenant?.email ?? null, businessName: tenant?.business_name ?? null }
}

// /m/, not /d/: the studio document page already owns /d/ and both are in PUBLIC_ROUTES, so the link
// in every owner's SMS would have resolved to the wrong page entirely.
const decideUrl = (token: string) => `${process.env.NEXT_PUBLIC_APP_URL}/m/${token}`

export interface NotifyResult {
  notified: boolean
  bySms: boolean
  byEmail: boolean
  error?: string
}

/**
 * Mint a decision token, put the draft in front of the owner, and record that it happened.
 *
 * The token is generated here and its HASH stored — the raw value exists only in the message, so a
 * leaked row cannot be used to send a reply in the owner's name.
 *
 * `notified` false is not swallowed. A draft that was held and never announced is precisely the state
 * this whole stage exists to prevent, so the failure is written to the row where the inbox can show
 * it, and the caller decides what to do about the message it was about to hold.
 */
export async function notifyOwner(
  db: SupabaseClient,
  draft: HeldDraft,
  opts: { who: string; agentName: string },
): Promise<NotifyResult> {
  const { token, hash } = generateApprovalToken()
  const { error: tokenErr } = await db
    .from('held_drafts').update({ decide_token_hash: hash }).eq('id', draft.id)

  // FAIL BEFORE SENDING, NOT AFTER. If the hash cannot be stored — the column is missing because a
  // migration has not been run, the row is gone — then the link in the message can never resolve, and
  // sending it would put a dead link in front of an owner who is being asked to decide something. A
  // probe caught exactly this: the token was minted, the update silently failed, and the page said the
  // link was invalid. The draft stays held either way; what changes is that the failure is reported.
  if (tokenErr) {
    const message = `token not stored: ${tokenErr.message}`
    console.error('[miles/notify]', message)
    await db.from('held_drafts').update({ notified_at: null, notify_error: message }).eq('id', draft.id)
    return { notified: false, bySms: false, byEmail: false, error: message }
  }

  const owner = await ownerOf(db, draft.tenant_id)
  const url = decideUrl(token)

  let bySms = false
  let byEmail = false
  const problems: string[] = []

  if (owner.phone) {
    // sendSMS THROWS on failure — unlike sendEmail, which returns { success: false } and never throws.
    // Two different contracts, so two different shapes of handling; a try/catch around the email would
    // be dead code.
    try {
      await sendSMS(owner.phone, smsBody(draft, opts.who, opts.agentName, url), undefined, { tenantId: draft.tenant_id })
      bySms = true
    } catch (err) {
      problems.push(`sms: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  if (owner.email) {
    const subject = `${opts.agentName} needs you: a reply to ${opts.who}`
    const res = await sendEmail(owner.email, subject, emailBody(draft, opts.who, opts.agentName, url))
    if (res.success) byEmail = true
    else problems.push(`email: ${res.error ?? 'failed'}`)
  }

  if (!owner.phone && !owner.email) problems.push('no phone or email on file for the owner')

  const notified = bySms || byEmail
  await db
    .from('held_drafts')
    .update({
      notified_at: notified ? new Date().toISOString() : null,
      notify_error: notified ? null : problems.join('; ') || 'not sent',
    })
    .eq('id', draft.id)

  return { notified, bySms, byEmail, error: notified ? undefined : problems.join('; ') }
}
