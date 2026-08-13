import type { ReactNode } from 'react'

// THE THREAD — the third shared component, and the only block in /v2 that a list row cannot express.
//
// ── WHY IT IS NOT A DetailRow ───────────────────────────────────────────────────────────────────────
//
// A DetailRow is { primary, detail, trailing }: one voice, left-aligned, a figure on the right. A
// thread is the opposite on every axis. Authorship decides alignment and colour; the body is prose,
// not a label; direction alternates; and time is a divider BETWEEN groups rather than a value on a
// row. Forcing it in would have meant DetailRow growing side, tone and isGroupStart — three fields no
// other caller wants, which is the same failure as a branch, spelled differently.
//
// Server component. Nothing here is interactive; `composer` takes the disabled control so the layout
// is honest about what the real screen has.

export interface ThreadMessage {
  id: string
  /** Authorship. Drives alignment and colour, and nothing else does. */
  side: 'them' | 'us'
  body: string
  /** ISO. The view formats it — a caller should never pass a pre-formatted time. */
  at: string
  /** Shown when a thread spans more than one channel; hidden when it does not. */
  channel?: string | null
  /** Rudi rather than a person. Both sit on the `us` side; only the label differs. */
  byAi?: boolean
  /** Delivery failed. A message state, not something to bury in the body. */
  failed?: boolean
}

export interface ThreadViewProps {
  messages: ThreadMessage[]
  emptyLabel: string
  composer?: ReactNode
}

const dayOf = (iso: string) => iso.slice(0, 10)

const dayLabel = (iso: string) => {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const d = dayOf(iso)
  if (d === today) return 'Today'
  if (d === yesterday) return 'Yesterday'
  return d
}

const timeOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16)
}

export function ThreadView({ messages, emptyLabel, composer }: ThreadViewProps) {
  if (messages.length === 0) {
    return (
      <>
        {/* Not "No messages" — what it MEANS, which is that the conversation has not started. */}
        <p className="v2-pnone">{emptyLabel}</p>
        {composer}
      </>
    )
  }

  // A channel label on every message is noise when a thread never leaves one channel, and the one
  // piece of information that matters when it does.
  const channels = new Set(messages.map((m) => m.channel).filter(Boolean))
  const showChannel = channels.size > 1

  return (
    <>
      <div className="v2-thread">
        {messages.map((m, i) => {
          const newDay = i === 0 || dayOf(m.at) !== dayOf(messages[i - 1].at)
          return (
            <div key={m.id}>
              {newDay && <p className="v2-tday">{dayLabel(m.at)}</p>}
              <div className="v2-msg" data-side={m.side} data-failed={m.failed || undefined}>
                <p>{m.body}</p>
                <span className="v2-mmeta">
                  {/* The same hue the row carried, when a thread actually spans channels. */}
                  {showChannel && m.channel && <i data-channel={m.channel} aria-hidden />}
                  {[
                    m.side === 'us' ? (m.byAi ? 'Rudi' : 'You') : null,
                    showChannel ? m.channel : null,
                    timeOf(m.at),
                    m.failed ? 'not delivered' : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {composer}
    </>
  )
}
