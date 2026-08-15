import { readAgenda } from '@/lib/appointments/agenda'
import { PERSONAS } from '@/lib/persona'
import { listPageContext, PREVIEW } from '../list-page'
import { agendaLine } from './line'
import { AgendaView } from './agenda'

// APPOINTMENTS — docs/miles/appointments-agenda-v2.html, both widths, values taken directly.
//
// Not ListPage. An agenda is not a filtered list: it is grouped by DAY, every row carries its own
// actions, and the actions differ by what kind of meeting it is. Forcing that through the shared list
// would mean a branch in ListPage for one screen, which is the thing its own comment forbids.
//
// The reference draws today and tomorrow, so this reads today FORWARD. Past and cancelled
// appointments have no home here — OUTSTANDING §27.

export const dynamic = 'force-dynamic'

export default async function V2Appointments() {
  const { tenantId } = await listPageContext('scheduling')
  const agenda = await readAgenda(tenantId)

  const laterCount = agenda.days.reduce((n, d, i) => n + (i === 0 && d.label.startsWith('TODAY') ? 0 : d.count), 0)
  const line = agendaLine({ todayCount: agenda.todayCount, laterCount, missingCount: agenda.missingCount })

  // The employee pill wears that employee's own wash, from the persona record — the same table the
  // conversation header and the thread bubbles read. Resolved here because PERSONAS is a server
  // module and the view is a client component.
  const tints = {
    rudi: { wash: PERSONAS.rudi.wash, ink: PERSONAS.rudi.washInk },
    miles: { wash: PERSONAS.miles.wash, ink: PERSONAS.miles.washInk },
    you: { wash: 'rgba(0, 0, 0, 0.05)', ink: 'var(--v2-ink-42)' },
  }

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <a href="/v2" className="v2-bk" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        <h2>Appointments</h2>
        <div className="v2-hacts">
          {/* The shape of what is coming. There is no owner-side create — /api/appointments/book is
              public and keyed by a lead token, meant for the AI — so this says so rather than being
              absent. OUTSTANDING §26. */}
          <button type="button" className="v2-hact" data-tone="primary" disabled title={PREVIEW}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        </div>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {agenda.days.length === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">Nothing booked</p>
              <p className="v2-pempty-b">Appointments booked from a call or a message land here.</p>
            </div>
          ) : (
            <>
              <p className="v2-ag-open">
                {line.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
              </p>
              <AgendaView agenda={agenda} tints={tints} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
