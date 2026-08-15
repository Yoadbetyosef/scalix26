import { readAgenda, readSlotGrid } from '@/lib/appointments/agenda'
import { createAdminClient } from '@/lib/supabase/server'
import { NewAppointment } from './new'
import { PERSONAS } from '@/lib/persona'
import { listPageContext } from '../list-page'
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
  const [agenda, grid, { data: tenant }] = await Promise.all([
    readAgenda(tenantId),
    // What the form OFFERS. The owner is not held to it — see /api/appointments.
    readSlotGrid(tenantId),
    createAdminClient().from('tenants').select('default_appointment_minutes').eq('id', tenantId).maybeSingle(),
  ])

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
          {/* Live. A disabled create on an empty screen means there is no way to ever put anything
              there — and the empty state is exactly when somebody wants it. */}
          <NewAppointment grid={grid} defaultMinutes={Number(tenant?.default_appointment_minutes) || 60} />
        </div>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {agenda.days.length === 0 && agenda.earlier.length === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">Nothing booked</p>
              <p className="v2-pempty-b">Appointments booked from a call or a message land here.</p>
            </div>
          ) : (
            <>
              {/* The line speaks about what is AHEAD. With nothing ahead it would be describing an
                  empty agenda over a screenful of last week, so it says that instead. */}
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
