import { readConversation } from '@/lib/inbox/conversation-read'
import { personaOf, nameOf } from '@/lib/persona'
import { relativeTime, PREVIEW } from '../../list-page'
import { channelKey, CHANNEL_LABEL } from '../../channels'
import { ChannelGlyph } from '../glyphs'
import { ConversationThread, type Line } from './thread'
import { TakeOver } from './takeover'

// ONE CONVERSATION. Same read, same data, new screen.
//
// It was a DetailPage: a title, some chips, a list of label/value facts and the thread inside a
// section. That shape says "a record with fields", and a conversation is not one — it is a thing that
// happened between three parties, and the questions somebody opens it with are who it was, what was
// said, and whether it still needs them. So: the header answers who, the strip answers what we know
// about them, and the thread answers the rest with authorship carried in colour.
//
// READ-ONLY, as every /v2 screen is. The take-over button renders and is disabled with
// title="v2 preview", which is also why the composer never appears — see takeover.tsx.

const str = (v: string | null | undefined) => (v && v.trim() ? v : null)

// Returns NULL when the record is missing rather than calling notFound(). This body renders in two
// places: as the route, where notFound() is the right answer, and as a PROP of a client component,
// where the same throw is no longer a routing signal and lands in error.tsx as a blank screen. The
// route decides; the body reports.
export async function ConversationBody({ tenantId, id }: { tenantId: string; id: string }) {
  const read = await readConversation(tenantId, id)
  if (!read) return null
  const { conv, messages } = read

  const contact = conv.contact
  const who = str(contact?.name) || str(contact?.phone) || str(contact?.email) || 'Someone'
  const ch = channelKey(conv.channel)
  // `persona` is joined now, so this is the employee's real record rather than a cast over a shape
  // that only carried a name — which is why every thread used to wear the phone employee's colours.
  const agent = conv.ai_employee ?? null
  const agentName = nameOf(agent)
  const persona = personaOf(agent)

  // AUTHORSHIP IS PER MESSAGE, from `role` — the column the table actually has.
  //
  //   user       the customer
  //   assistant  the employee answered
  //   agent      a person sent it
  //
  // It was `direction`, which does not exist on the row, so the test was never true and every
  // message rendered as the agent's. And it fell back to conv.human_takeover, which is per
  // CONVERSATION: the moment somebody took a thread over, every reply the employee had already sent
  // would have been relabelled as theirs. A message's author does not change because a later one had
  // a different one.
  const lines: Line[] = messages.map((m) => ({
    id: m.id,
    by: m.role === 'user' ? 'customer' : m.role === 'agent' ? 'you' : 'agent',
    body: str(m.content) ?? '(no content)',
    at: m.timestamp,
    agentName,
    persona: persona.key,
    // delivery_status, not status. The provider callback resolves it; until then it is null, which is
    // not a failure — only these two are.
    failed: m.delivery_status === 'failed' || m.delivery_status === 'undelivered',
  }))

  const last = lines.at(-1) ?? null
  const started = conv.created_at.slice(0, 10)

  // The strip. A fact with no value renders an em dash rather than disappearing: "we do not have an
  // email for them" is a different thing from "there is no such field", and the first is worth knowing.
  const facts: { k: string; v: string | null }[] = [
    { k: 'PHONE', v: str(contact?.phone) },
    { k: 'EMAIL', v: str(contact?.email) },
    { k: 'FIRST SEEN', v: started },
    { k: 'MESSAGES', v: String(lines.length) },
  ]

  // THIS CONVERSATION — facts about the thread rather than about the person. Deliberately a separate
  // list from the one above: the two answer different questions and merging them into one grid asks
  // the reader to sort them.
  const about: { k: string; v: string | null }[] = [
    { k: 'CHANNEL', v: ch ? CHANNEL_LABEL[ch] ?? conv.channel : str(conv.channel) },
    { k: 'STATUS', v: str(conv.status) },
    { k: 'ANSWERED BY', v: conv.human_takeover ? 'You' : agentName },
    { k: 'LAST MESSAGE', v: last ? relativeTime(last.at) : null },
  ]

  const whatHappened = str(conv.summary) ? (
    <section className="v2-csum">
      <p className="v2-csumh"><i style={{ background: persona.accent }} />WHAT HAPPENED</p>
      <p className="v2-csumt">{str(conv.summary)}</p>
    </section>
  ) : null

  const factList = (title: string, rows: { k: string; v: string | null }[]) => (
    <section className="v2-cabout">
      <p className="v2-ctlab">{title}</p>
      <dl className="v2-cfacts">
        {rows.map((f) => (
          <div key={f.k}>
            <dt>{f.k}</dt>
            <dd data-empty={f.v ? undefined : true}>{f.v ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )

  return (
    <div className="v2-conv">
      <header className="v2-chd">
        <div className="v2-chr">
          <a href="/v2/inbox" className="v2-bk" aria-label="Inbox">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </a>
          <ChannelGlyph channel={ch} />
          <div className="v2-cwho-h">
            <p className="v2-chn">{who}</p>
            <p className="v2-chmeta">
              {/* The channel word wears the channel's own hue — the same table the list marks use. */}
              <span data-channel={ch ?? undefined}>{(ch ? CHANNEL_LABEL[ch] ?? conv.channel : conv.channel ?? 'MESSAGE').toUpperCase()}</span>
              <span>·</span>
              <span>{started}</span>
            </p>
          </div>
          {/* Whose thread it is, in that employee's own colours. */}
          <span className="v2-cagent" style={{ background: persona.wash, color: persona.washInk }}>
            {agentName}
          </span>
        </div>
      </header>

      <div className="v2-cstrip">
        <div className="v2-cs">
          {facts.map((f) => (
            <div key={f.k} className="v2-ci">
              <p className="v2-cik">{f.k}</p>
              <p className="v2-civ" data-empty={f.v ? undefined : true}>{f.v ?? '—'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="v2-cscr" data-scroll>
        <div className="v2-cinner">
          {/* On a phone these sit in the flow; above 1100px the same nodes move into the sidebar.
              See the media query — nothing is rendered twice. */}
          {/* WHAT HAPPENED — the card exists; the recap does not. It needs a written summary, which is
              a new read and possibly a model call, and inventing one from the last message would be a
              screen asserting something nobody wrote. Rendered only when there is something real to show;
              `summary` is the one field that already carries a written line. */}
          <div className="v2-cside">
            {whatHappened}
            {factList('CONTACT', facts)}
            {factList('THIS CONVERSATION', about)}
          </div>

          <p className="v2-ctlab">CONVERSATION</p>
          <ConversationThread lines={lines} who={who} emptyLabel={`Nothing has been said to ${who} yet.`} />

        </div>
      </div>

      {/* ONE instance, and one `live` state with it. On a phone it is the pinned block at the
          bottom; above 1100px `.v2-conv` becomes a grid and this same node sits in the header row
          beside the employee's name. Rendering it twice would be two controls with two states, and
          the one that is hidden is the one that would fall out of step. */}
      <TakeOver agentName={agentName} canSend={false} disabledReason={PREVIEW} />
    </div>
  )
}
