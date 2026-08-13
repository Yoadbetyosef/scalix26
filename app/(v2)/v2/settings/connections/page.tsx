import type React from 'react'
import Link from 'next/link'
import { Calendar, CalendarClock, Phone, Mail, CreditCard, ChevronRight } from 'lucide-react'
import { FacebookGlyph, InstagramGlyph } from '../../brand-glyphs'
import { getIntegrationStates, type IntegrationState } from '@/lib/assistant/integrations'
import { listPageContext } from '../../list-page'
import { connectionsLine } from './line'

// CONNECTIONS — one page where a person connects everything once.
//
// Grouped by CAPABILITY rather than by vendor: the heading says what it unlocks and the row underneath
// names the provider. Nobody wakes up wanting to connect Twilio; they want Rudi to answer the phone.
//
// Each row states what is NOT possible without it, and only when it is missing. That is what makes
// someone finish setup; a red badge only tells them they failed at something.
//
// It carries exactly the six providers getIntegrationStates can report on. QuickBooks, Google
// Business, the number pool, A2P status and Release Number are deferred — OUTSTANDING item 8 — because
// a row that cannot say something true about its state does not belong here, and a design-only pass
// does not authorise new reads.
//
// The markup reuses the sheet's own classes: .v2-group, .v2-gcard, .v2-grow, .v2-gchip, .v2-glab.
// No parallel settings classes — one design language, and a press or a chip still changes in one place.

export const dynamic = 'force-dynamic'

type Key = keyof Awaited<ReturnType<typeof getIntegrationStates>>

interface Row { provider: string; key: Key; icon: React.ComponentType; without: string }

// Capability is the heading; the provider is the row. Nothing is grouped by who sells it.
const CAPABILITIES: Array<{ id: string; heading: string; verb: string; hue: string; rows: Row[] }> = [
  {
    id: 'book', heading: 'So Rudi can book', verb: 'book anything', hue: 'var(--v2-t1)',
    rows: [
      { provider: 'Google Calendar', key: 'calendar', icon: Calendar, without: 'Rudi cannot see when you are free, so it cannot book.' },
      { provider: 'Outlook', key: 'outlook', icon: CalendarClock, without: 'A business on Microsoft cannot be booked into without this.' },
    ],
  },
  {
    id: 'answer', heading: 'So Rudi can answer everywhere', verb: 'answer', hue: 'var(--v2-t3)',
    rows: [
      { provider: 'Phone & SMS', key: 'twilio', icon: Phone, without: 'No number to answer on, so calls and texts go nowhere.' },
      { provider: 'Email', key: 'email', icon: Mail, without: 'Email arrives and nobody replies to it.' },
      { provider: 'Facebook', key: 'facebook', icon: FacebookGlyph, without: 'Messages to your page go unanswered.' },
      { provider: 'Instagram', key: 'instagram', icon: InstagramGlyph, without: 'Instagram DMs go unanswered.' },
    ],
  },
  {
    id: 'work', heading: 'So Rudi can bring you work', verb: 'take payment', hue: 'var(--v2-t4)',
    rows: [
      { provider: 'Stripe', key: 'stripe', icon: CreditCard, without: 'Rudi cannot send a payment link or take a deposit.' },
    ],
  },
]

export default async function V2Connections() {
  const { tenantId } = await listPageContext()
  const states = await getIntegrationStates(tenantId)

  const all = CAPABILITIES.flatMap((c) => c.rows)
  const live = all.filter((r) => states[r.key] === 'live').length
  const review = all.filter((r) => states[r.key] === 'review').length
  const blocked = CAPABILITIES.filter((c) => c.rows.every((r) => states[r.key] !== 'live')).map((c) => c.verb)

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href="/v2" className="v2-bk" aria-label="Home">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <h2>Connections</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        <p className="v2-lin">
          {connectionsLine({ live, review, blocked })
            .map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </p>

        <div className="v2-stagger">
          {CAPABILITIES.map((c) => (
            <div key={c.id} className="v2-group" style={{ ['--ghue' as string]: c.hue }}>
              <p className="v2-ghead"><i />{c.heading}<s /></p>
              <div className="v2-gcard">
                {c.rows.map((r) => {
                  const state: IntegrationState = states[r.key]
                  const Icon = r.icon
                  return (
                    <div key={r.key} className="v2-grow" data-conn={state}>
                      <span className="v2-gchip"><Icon /></span>
                      <span className="v2-glab">
                        {r.provider}
                        {/* Only when it is missing. A connected row has nothing to warn about, and
                            repeating the warning there would be nagging. */}
                        {state !== 'live' && <em>{r.without}</em>}
                      </span>
                      <span className="v2-gtrail">
                        {/* Live is TRANSIENT state, so it takes the pale wash and the mono voice —
                            the same treatment the rail gives its AI badge. In review says the wait is
                            the provider's. Connect is the only thing here that needs the person. */}
                        {state === 'live' && <b className="v2-connlive">Live</b>}
                        {state === 'review' && <b className="v2-connrev">In review · nothing for you to do</b>}
                        {state === 'connect' && <b className="v2-conngo">Connect<ChevronRight /></b>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
