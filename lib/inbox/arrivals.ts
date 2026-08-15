import { createAdminClient } from '@/lib/supabase/server'
import { readMilesInbox } from '@/lib/miles/inbox-read'

// WHO ARRIVED, AND WAS THEY LOOKED AFTER.
//
// The home screen used to answer this from `leads`: activeLeads = status in ('new','contacted'),
// rendered as "N leads have not been answered". Speed-to-Lead sets `contacted` at the moment it
// ANSWERS, so every arrival the AI handled within seconds was reported, in those words, as
// unanswered. On the live table: zero leads in `new`, and the badge still read 1.
//
// The truth about whether a thread was handled lives in ONE place — the inbox's own grouping, where
// `needs` means the customer spoke last and nothing answered and `handled` quotes what went out. So
// this reads that, rather than deriving a second opinion that can drift from the screen it describes
// (OUTSTANDING §7j: when two things must agree, make them one thing).
//
// ── "NEW" IS FIRST-CONVERSATION, NOT FIRST-LEAD ─────────────────────────────────────────────────
//
// A lead row is one arrival event: twelve of them on the live table are four people. What an owner
// means by "someone new" is a person they have not dealt with before, so it is the contact's FIRST
// conversation — two bounded queries, no scan of the whole table.
//
// The day is the BUSINESS's day, not UTC. "3 new people today" flipping at 8pm local because the
// server counts in London is the same species of small lie this module exists to remove.

export interface Arrivals {
  /** People whose first ever conversation happened today, in the business's timezone. */
  newToday: number
  /** How many of those have nothing waiting on the owner — the "all handled" half. */
  newHandled: number
  /** Drafts held for a decision. The inbox's first group. */
  drafts: number
  /** Customers who spoke last and have had no answer. The inbox's second group. */
  unanswered: number
}

export const waitingCount = (a: Arrivals) => a.drafts + a.unanswered

const dayIn = (tz: string, at: string | Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at instanceof Date ? at : new Date(at))

export async function loadArrivals(tenantId: string, timezone: string | null | undefined): Promise<Arrivals> {
  let tz = timezone || 'America/New_York'
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch { tz = 'America/New_York' }

  const db = createAdminClient()
  const today = dayIn(tz, new Date())
  // A 48-hour UTC window is a superset of any timezone's "today"; the exact day is decided by
  // comparing each row's LOCAL date below. Bounded, and correct at every offset.
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const [inbox, recentRes] = await Promise.all([
    readMilesInbox(tenantId, ''),
    db.from('conversations').select('id, contact_id, created_at').eq('tenant_id', tenantId).gte('created_at', since),
  ])

  const todays = ((recentRes.data ?? []) as { id: string; contact_id: string | null; created_at: string }[])
    .filter((c) => !!c.contact_id && dayIn(tz, c.created_at) === today)

  const contactIds = [...new Set(todays.map((c) => c.contact_id as string))]
  let firstTimers = new Set(contactIds)
  if (contactIds.length) {
    // Anyone with a conversation from BEFORE today has been dealt with before, so is not new.
    const { data: prior } = await db
      .from('conversations')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .in('contact_id', contactIds)
      .lt('created_at', since)
    const seen = new Set((prior ?? []).map((p) => (p as { contact_id: string | null }).contact_id))
    // The 48-hour window is a superset, so a conversation inside it but on an EARLIER local day also
    // disqualifies. Checked here rather than with a third query.
    for (const c of (recentRes.data ?? []) as { contact_id: string | null; created_at: string }[]) {
      if (c.contact_id && dayIn(tz, c.created_at) !== today) seen.add(c.contact_id)
    }
    firstTimers = new Set(contactIds.filter((id) => !seen.has(id)))
  }

  // The inbox's own answer to "is this handled": a thread is outstanding if it is in either of the
  // two groups that need a person. Everything else the inbox calls handled.
  const outstanding = new Set<string>([
    ...inbox.waiting.map((r) => r.conversationId).filter((id): id is string => !!id),
    ...inbox.needs.map((r) => r.conversationId),
  ])
  const contactOutstanding = new Set(
    todays.filter((c) => outstanding.has(c.id)).map((c) => c.contact_id as string),
  )

  return {
    newToday: firstTimers.size,
    newHandled: [...firstTimers].filter((id) => !contactOutstanding.has(id)).length,
    drafts: inbox.waiting.length,
    unanswered: inbox.needs.length,
  }
}
