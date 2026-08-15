import { readConversation } from '@/lib/inbox/conversation-read'
import { personaOf, nameOf } from '@/lib/persona'
import { relativeTime, PREVIEW } from '../../list-page'
import { channelKey, CHANNEL_LABEL } from '../../channels'
import { ChannelGlyph } from '../glyphs'
import { ConversationThread, type Line } from './thread'
import { TakeOver } from './takeover'
import { StopFollowUps } from './follow-ups'
import { sourceLabel } from '@/lib/leads/source'

// ONE CONVERSATION — docs/miles/conversation-FINAL.html, both widths, values taken directly.
//
// THE TWO LAYOUTS ARE ONE DOM. The sidebar column is written FIRST and placed second by the grid,
// which is what lets a phone read WHAT HAPPENED before the thread while a desktop puts it beside the
// thread — without a second render of either.
//
// The contact strip is a MOBILE pattern and stops at 1100px: above that the sidebar already carries
// those facts, and a screen that says everything twice trusts neither copy.
//
// READ-ONLY except the take-over slot, which is the one thing in /v2 that writes — see takeover.tsx
// and the note in leads.test.ts.

const str = (v: string | null | undefined) => (v && v.trim() ? v : null)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "8 Aug 2026" — one format, upper-cased by the header and left alone by the facts. */
const day = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Returns NULL when the record is missing rather than calling notFound(). This body renders in two
// places: as the route, where notFound() is the right answer, and as a PROP of a client component,
// where the same throw is no longer a routing signal and lands in error.tsx as a blank screen. The
// route decides; the body reports.
export async function ConversationBody({ tenantId, id }: { tenantId: string; id: string }) {
  const read = await readConversation(tenantId, id)
  if (!read) return null
  const { conv, messages, origin } = read

  const contact = conv.contact
  const who = str(contact?.name) || str(contact?.phone) || str(contact?.email) || 'Someone'
  const ch = channelKey(conv.channel)
  const channelWord = ch ? CHANNEL_LABEL[ch] : str(conv.channel)

  // `persona` is joined, so this is the employee's real record rather than a cast over a shape that
  // only carried a name — which is why every thread used to wear the phone employee's colours.
  const agent = conv.ai_employee ?? null
  const agentName = nameOf(agent)
  const persona = personaOf(agent)

  // AUTHORSHIP IS PER MESSAGE, from `role` — the column the table actually has.
  //   user = the customer · assistant = the employee answered · agent = a person sent it
  const lines: Line[] = messages.map((m) => ({
    id: m.id,
    by: m.role === 'user' ? 'customer' : m.role === 'agent' ? 'you' : 'agent',
    body: str(m.content) ?? '(no content)',
    at: m.timestamp,
    agentName,
    persona: persona.key,
    // delivery_status, not status: null until a provider callback resolves it, which is not a failure.
    failed: m.delivery_status === 'failed' || m.delivery_status === 'undelivered',
  }))

  const last = lines.at(-1) ?? null

  // A fact with no value renders an em dash rather than disappearing: "we have no email for them" is
  // a different thing from "there is no such field", and the first is worth knowing.
  const person: { k: string; v: string | null }[] = [
    { k: 'Phone', v: str(contact?.phone) },
    { k: 'Email', v: str(contact?.email) },
    { k: 'First seen', v: day(conv.created_at) },
    { k: 'Messages', v: String(lines.length) },
  ]

  // Facts about the THREAD rather than about the person. Two lists under two headings, because
  // merging them into one grid asks the reader to sort them.
  const about: { k: string; v: string | null }[] = [
    { k: 'Channel', v: channelWord },
    // WHERE THEY CAME FROM, beside how they are talking to you — the neighbouring question, and the
    // one fact the leads screen carried that lived nowhere else. From their EARLIEST lead: a
    // returning customer opens a new one every call, so the newest says "phone call" about somebody
    // who first found you through a web form.
    { k: 'Came from', v: sourceLabel(origin.source) },
    { k: 'Status', v: str(conv.status) },
    { k: 'Answered by', v: conv.human_takeover ? 'You' : agentName },
    { k: 'Last message', v: last ? relativeTime(last.at) : null },
  ]

  const factGroup = (title: string, rows: { k: string; v: string | null }[]) => (
    <section className="v2-sgrp" data-wide>
      <p className="v2-sl">{title}</p>
      {rows.map((f) => (
        <div key={f.k} className="v2-f">
          <span className="v2-fk">{f.k}</span>
          <span className="v2-fv" data-empty={f.v ? undefined : true}>{f.v ?? '—'}</span>
        </div>
      ))}
    </section>
  )

  // The strip carries the same facts in the phone's own order, plus the status the sidebar keeps in
  // its second group. One source, two presentations — not two lists.
  const stripFacts = [person[0], person[1], { k: 'Status', v: str(conv.status) }, person[3], person[2]]

  return (
    <div className="v2-conv">
      <header className="v2-chd">
        <div className="v2-hin">
          <a href="/v2/inbox" className="v2-bk" aria-label="Inbox">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </a>
          <ChannelGlyph channel={ch} />
          <div className="v2-hw">
            <p className="v2-hn">{who}</p>
            <p className="v2-hm">
              {/* The channel word in the channel's own INK — as text on white the mark's full
                  strength is unreadable for two of them. Same table, the column meant for this. */}
              <span className="v2-c" data-channel={ch ?? undefined}>{(channelWord ?? 'message').toUpperCase()}</span>
              <span>·</span>
              <span>{(day(conv.created_at) ?? '').toUpperCase()}</span>
            </p>
          </div>
          {/* Whose thread it is, in that employee's own colours. */}
          <span className="v2-agent" style={{ background: persona.wash, color: persona.washInk }}>
            {agentName.toUpperCase()}
          </span>

          {/* Secondary, and only secondary. Take over is the primary thing on this screen and lives
              in the slot at the foot of the thread. Resolve and Close change the conversation's
              STATUS — real actions on the v1 screen, not yet wired here, so they say so. */}
          <button type="button" className="v2-sec" disabled title={PREVIEW}>Resolve</button>
          <button type="button" className="v2-sec" disabled title={PREVIEW}>Close</button>
          {/* And one that IS wired: the brake on the follow-up sequence, which used to be "Dismiss"
              on a list beside a name and a phone number. Here the owner has just read what was said.
              Absent entirely when nothing is running — a control that stops nothing is noise. */}
          {origin.activeFollowUps > 0 && (
            <StopFollowUps conversationId={conv.id} count={origin.activeFollowUps} />
          )}
        </div>
      </header>

      {/* MOBILE ONLY. Above 1100px the sidebar carries these and this is gone. */}
      <div className="v2-cstrip">
        <div className="v2-cs">
          {stripFacts.map((f) => (
            <div key={f.k} className="v2-ci">
              <p className="v2-cik">{f.k.toUpperCase()}</p>
              <p className="v2-civ" data-empty={f.v ? undefined : true}>{f.v ?? '—'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="v2-cscr" data-scroll>
        <div className="v2-wrap">
          {/* SOURCE ORDER IS THE PHONE'S ORDER. The grid places this second; a phone reads it first,
              which is why it is written first. */}
          <aside className="v2-side">
            {/* WHAT HAPPENED — `recap` and only `recap`, written once when the conversation
                completes (lib/conversations/recap.ts). NOT `summary`: on email that column holds the
                subject line, so reading it here would put "Re: quote for Tuesday" under a heading
                promising an account of what happened. Heading inside the condition — an empty
                section reads as a broken screen rather than an empty one. */}
            {str(conv.recap) && (
              <section className="v2-sgrp">
                <p className="v2-sl">WHAT HAPPENED</p>
                <p className="v2-sum">{str(conv.recap)}</p>
              </section>
            )}
            {factGroup('CONTACT', person)}
            {factGroup('THIS CONVERSATION', about)}
          </aside>

          <div className="v2-tcol">
            <p className="v2-tl">CONVERSATION</p>
            <ConversationThread lines={lines} who={who} emptyLabel={`Nothing has been said to ${who} yet.`} />
          </div>
        </div>
      </div>

      {/* THE SLOT. Outside the scroller, in the same 1076px container as the thread and in its column
          only — so it ends where the messages end rather than running under the sidebar. */}
      <TakeOver conversationId={conv.id} agentName={agentName} takenOver={conv.human_takeover === true} />
    </div>
  )
}
