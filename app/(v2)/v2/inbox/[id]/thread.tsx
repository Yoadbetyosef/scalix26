import { personaOf } from '@/lib/persona'

// THE THREAD, WITH THREE AUTHORS.
//
// The shared ThreadView has two sides and one voice on each: them, and us. A conversation an employee
// answered and a person then took over has THREE — the customer, the employee, and the owner — and
// they are not the same kind of thing. Collapsing the last two into "us" loses the only fact somebody
// opening this screen is looking for: which of those two said the thing in their name.
//
// That is a new field on every message, not a branch: `by`. Hence a component rather than a fourth
// parameter on ThreadView, whose own comment says a caller needing a branch means the shape is wrong.
//
// Colour carries the authorship. The employee's bubble is filled with THAT employee's own wash — one
// glance says which of them answered, in a thread where both may have.

export interface Line {
  id: string
  by: 'customer' | 'agent' | 'you'
  body: string
  /** ISO. The view formats it; a caller must never pass a pre-formatted time. */
  at: string
  /** The employee's name, on their own lines. */
  agentName?: string | null
  /** Which employee, so the bubble wears their wash. */
  persona?: string | null
  failed?: boolean
}

const dayOf = (iso: string) => iso.slice(0, 10)

const dayLabel = (iso: string) => {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const d = dayOf(iso)
  if (d === today) return 'TODAY'
  if (d === yesterday) return 'YESTERDAY'
  return d
}

const timeOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16)
}

export function ConversationThread({ lines, who, emptyLabel }: { lines: Line[]; who: string; emptyLabel: string }) {
  if (lines.length === 0) return <p className="v2-pnone">{emptyLabel}</p>

  return (
    <div className="v2-cthread">
      {lines.map((l, i) => {
        const prev = i > 0 ? lines[i - 1] : null
        const newDay = !prev || dayOf(l.at) !== dayOf(prev.at)
        // A RUN: the same author speaking again, on the same day. It drops its label and closes the
        // gap, so two bubbles read as one turn. Repeating the name above every bubble is what makes
        // a thread read as a list of records rather than as a conversation — and a day divider ends
        // a run, because a reply the next morning is not the same breath.
        const run = !!prev && !newDay && prev.by === l.by
        // The employee's own colours, from the persona map. `you` and the customer take the two fixed
        // treatments; only the agent's bubble varies, and it varies with WHO the agent is.
        const p = l.by === 'agent' ? personaOf({ persona: l.persona }) : null
        const label = l.by === 'customer' ? who.toUpperCase() : l.by === 'you' ? 'YOU' : (l.agentName || p?.name || 'AI').toUpperCase()
        return (
          <div key={l.id} className="v2-cwrap">
            {newDay && <p className="v2-cday">{dayLabel(l.at)}</p>}
            <div
              className="v2-cb"
              data-by={l.by}
              data-run={run || undefined}
              data-failed={l.failed || undefined}
              style={p ? ({ '--wash': p.wash, '--wash-ink': p.washInk } as React.CSSProperties) : undefined}
            >
              {!run && <p className="v2-cwho">{label}</p>}
              <p className="v2-ctext">{l.body}</p>
              <p className="v2-cstamp">{timeOf(l.at)}{l.failed ? ' · not delivered' : ''}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
