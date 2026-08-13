import { readConversation } from '@/lib/inbox/conversation-read'
import { DetailPage, type DetailFact } from '../../detail'
import { ThreadView, type ThreadMessage } from '../../thread'
import { relativeTime, PREVIEW } from '../../list-page'
import { channelKey, CHANNEL_LABEL } from '../../channels'
import { conversationLine } from './line'

// One conversation, reskinned. readConversation is the /inbox/[id] page's own read, extracted verbatim
// — same queries, same join, same ordering. No new query. READ-ONLY: the composer and the takeover
// control render disabled with title="v2 preview".

const str = (v: string | null | undefined) => (v && v.trim() ? v : null)

// Returns NULL when the record is missing rather than calling notFound(). This body renders in two
// places: as the route, where notFound() is the right answer, and as a PROP of ListPage — a client
// component — where the same throw is no longer a routing signal and lands in error.tsx as a blank
// screen instead. The route decides; the body reports. Same rule as the lib/ extractions.
//
// tenantId is an argument for the same reason: listPageContext() calls redirect() on a missing module,
// and a redirect thrown from inside a client component's prop fails the same way.
export async function ConversationBody({ tenantId, id }: { tenantId: string; id: string }) {
  const read = await readConversation(tenantId, id)
  if (!read) return null
  const { conv, messages } = read

  const contact = conv.contact
  const who = str(contact?.name) || str(contact?.phone) || str(contact?.email) || 'Someone'

  // `direction` is the row's own word for authorship — inbound is them, everything else is us.
  const thread: ThreadMessage[] = messages.map((m) => ({
    id: m.id,
    side: m.direction === 'inbound' ? 'them' : 'us',
    body: str(m.content) ?? '(no content)',
    at: m.timestamp,
    channel: m.channel,
    // The agent answered unless a person had taken the conversation over by then.
    byAi: m.direction !== 'inbound' && !conv.human_takeover,
    failed: m.status === 'failed' || m.status === 'undelivered',
  }))

  const last = thread.at(-1) ?? null

  const facts: DetailFact[] = [
    { label: 'Phone', value: str(contact?.phone) },
    { label: 'Email', value: str(contact?.email) },
    { label: 'Channel', value: str(conv.channel) },
    { label: 'Status', value: str(conv.status) },
    { label: 'Answered by', value: conv.human_takeover ? 'You' : str(conv.ai_employee?.name) ?? 'Rudi' },
    { label: 'Started', value: conv.created_at.slice(0, 10) },
  ]

  return (
    <DetailPage
      backHref="/v2/inbox"
      backLabel="Inbox"
      eyebrow={str(contact?.phone) ?? str(contact?.email)}
      title={who}
      chips={[
        ...(str(conv.channel) ? [{ label: CHANNEL_LABEL[channelKey(conv.channel)!] ?? conv.channel, channel: channelKey(conv.channel) }] : []),
        ...(conv.human_takeover ? [{ label: 'You took over', tone: 'accent' as const }] : []),
      ]}
      line={conversationLine({
        who,
        messages: thread.length,
        handledByAi: !!conv.ai_employee,
        takenOver: conv.human_takeover === true,
        lastFrom: last?.side ?? null,
        lastAgo: last ? relativeTime(last.at) : null,
      })}
      actions={[
        { label: conv.human_takeover ? 'Hand back to Rudi' : 'Take over', tone: 'primary', disabledReason: PREVIEW },
        { label: 'Close conversation', disabledReason: PREVIEW },
      ]}
      sections={[
        ...(str(conv.summary) ? [{ title: 'What Rudi took from it', facts: [{ label: 'Summary', value: str(conv.summary) }] }] : []),
        {
          title: 'Conversation',
          extra: (
            <ThreadView
              messages={thread}
              emptyLabel={`Nothing has been said to ${who} yet.`}
              composer={
                <div className="v2-dacts" style={{ marginTop: 18 }}>
                  <button type="button" className="v2-ract" data-tone="primary" disabled title={PREVIEW}>Reply</button>
                </div>
              }
            />
          ),
        },
        { title: 'Contact', facts },
      ]}
    />
  )
}
