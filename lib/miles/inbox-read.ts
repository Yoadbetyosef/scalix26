import { createAdminClient } from '@/lib/supabase/server'
import { COMMITMENT_LABEL, type Commitment } from './autonomy'

// THE THREE GROUPS — waiting on you, needs you, handled.
//
// Not three queries with three ideas of what a conversation is. One read of the message channels,
// one read of what is held, and the groups fall out of the state each thread is actually in:
//
//   WAITING ON YOU  a draft exists and nobody has decided        (held_drafts, status pending)
//   NEEDS YOU       the customer spoke last and nothing answered (last message is theirs, no draft)
//   MILES HANDLED   the agent answered, and here is what it said (last message is the agent's)
//
// Voice is excluded throughout. Rudi keeps the phone; this screen is the messages employee's.

/** The channels Miles owns. `whatsapp` is here because it is a message, whatever the brief listed. */
const MESSAGE_CHANNELS = ['sms', 'whatsapp', 'instagram', 'facebook', 'email']

export interface WaitingRow {
  draftId: string
  conversationId: string | null
  who: string
  channel: string | null
  /** ISO. The row shows how long it has waited, and the draft box repeats it in words. */
  heldSince: string
  /** What the customer asked, so the draft is never read without its question. */
  question: string | null
  /** The draft, verbatim, exactly as it would send. */
  body: string
  reasons: Commitment[]
  /**
   * False when the draft was held but neither the SMS nor the email reached the owner. Shown on the
   * row, because a draft nobody was told about is the one state this whole arrangement exists to
   * prevent, and hiding it would make the queue look healthy while a customer waits.
   */
  announced: boolean
  announceError: string | null
  /**
   * The classifier's reason IN ITS OWN WORDS, with the text that triggered it quoted.
   *
   * "Draft ready" is what the mockup's row says and it is not enough: a row that does not say why it
   * was held gets approved without being read, which is the one failure this feature cannot survive.
   */
  trigger: string
}

export interface NeedsRow {
  conversationId: string
  who: string
  channel: string | null
  at: string
  /** What they said. Not a summary of it — theirs. */
  said: string
}

export interface HandledRow {
  conversationId: string
  who: string
  channel: string | null
  at: string
  /** THE EXACT TEXT THAT WENT OUT in the owner's name. A row saying "handled" without it is the
   *  thing that would destroy trust in this feature. */
  sent: string
}

export interface MilesInbox {
  waiting: WaitingRow[]
  needs: NeedsRow[]
  handled: HandledRow[]
  /** The agent's own name, for the lines that speak about it. */
  agentName: string
}

interface ConvRow {
  id: string
  channel: string | null
  updated_at: string | null
  human_takeover: boolean | null
  contact: { name?: string | null; phone?: string | null; email?: string | null } | null
}

interface MsgRow {
  id: string
  conversation_id: string
  role: string
  content: string
  timestamp: string
}

const nameOfContact = (c: ConvRow['contact']): string =>
  c?.name?.trim() || c?.phone?.trim() || c?.email?.trim() || 'Someone'

/** One line: what the classifier called it, and the words that caused it. */
export function triggerLine(reasons: Commitment[]): string {
  if (!reasons?.length) return 'Held for review'
  const first = reasons[0]
  const label = COMMITMENT_LABEL[first.kind] ?? 'Held for review'
  // An evidence string that is a placeholder rather than a quotation reads badly in quotes.
  const quoted = first.evidence?.startsWith('(') ? null : first.evidence
  const head = quoted ? `${label} · “${quoted}”` : label
  // Counted by KIND, not by reason. The same complaint found in both the customer's message and the
  // reply is one thing to know about, and "+1" implying a second, different reason is the row telling
  // a small lie about what it is showing.
  const kinds = new Set(reasons.map((r) => r.kind))
  return kinds.size > 1 ? `${head} +${kinds.size - 1}` : head
}

export async function readMilesInbox(tenantId: string, agentName: string): Promise<MilesInbox> {
  const db = createAdminClient()

  const [convRes, draftRes] = await Promise.all([
    db
      .from('conversations')
      .select('id, channel, updated_at, human_takeover, contact:contacts(name, phone, email)')
      .eq('tenant_id', tenantId)
      .in('channel', MESSAGE_CHANNELS)
      .order('updated_at', { ascending: false })
      .limit(40),
    db
      .from('held_drafts')
      .select('id, conversation_id, channel, body, reasons, inbound_excerpt, created_at, contact_id, notified_at, notify_error')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ])

  const convs = (convRes.data ?? []) as unknown as ConvRow[]
  const drafts = (draftRes.data ?? []) as unknown as Array<{
    id: string; conversation_id: string | null; channel: string | null; body: string
    reasons: Commitment[]; inbound_excerpt: string | null; created_at: string
    notified_at: string | null; notify_error: string | null
  }>

  // The last message on each of those threads, in one read rather than one per conversation.
  const ids = convs.map((c) => c.id)
  let lastByConv = new Map<string, MsgRow>()
  if (ids.length) {
    const { data } = await db
      .from('messages')
      .select('id, conversation_id, role, content, timestamp')
      .in('conversation_id', ids)
      .order('timestamp', { ascending: true })
    for (const m of (data ?? []) as unknown as MsgRow[]) lastByConv.set(m.conversation_id, m)
  }

  const byId = new Map(convs.map((c) => [c.id, c]))
  const held = new Set(drafts.map((d) => d.conversation_id).filter(Boolean) as string[])

  const waiting: WaitingRow[] = drafts.map((d) => {
    const conv = d.conversation_id ? byId.get(d.conversation_id) : undefined
    return {
      draftId: d.id,
      conversationId: d.conversation_id,
      who: conv ? nameOfContact(conv.contact) : 'Someone',
      channel: d.channel ?? conv?.channel ?? null,
      heldSince: d.created_at,
      question: d.inbound_excerpt,
      body: d.body,
      reasons: d.reasons ?? [],
      announced: !!d.notified_at,
      announceError: d.notified_at ? null : d.notify_error,
      trigger: triggerLine(d.reasons ?? []),
    }
  })

  const needs: NeedsRow[] = []
  const handled: HandledRow[] = []

  for (const c of convs) {
    // A thread with a draft waiting is in the first group and nowhere else — it would otherwise also
    // qualify as "needs you", and one thread appearing twice makes the counts a lie.
    if (held.has(c.id)) continue
    const last = lastByConv.get(c.id)
    if (!last) continue

    if (last.role === 'user') {
      needs.push({
        conversationId: c.id,
        who: nameOfContact(c.contact),
        channel: c.channel,
        at: last.timestamp,
        said: last.content,
      })
    } else if (last.role === 'assistant' || last.role === 'agent') {
      // Only the AI's own replies belong under "handled". A message a PERSON sent after taking the
      // thread over is not something the agent did, and crediting it would overstate the feature.
      if (c.human_takeover) continue
      handled.push({
        conversationId: c.id,
        who: nameOfContact(c.contact),
        channel: c.channel,
        at: last.timestamp,
        sent: last.content,
      })
    }
  }

  return { waiting, needs, handled, agentName }
}
