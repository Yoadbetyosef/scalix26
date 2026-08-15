'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Agenda, AgendaRow } from '@/lib/appointments/agenda'
import { PREVIEW } from '../preview'

// THE AGENDA — docs/miles/appointments-agenda-v2.html, values taken directly.
//
// ── THE KIND DRIVES THE PRIMARY ACTION, NOT JUST THE COLOUR ─────────────────────────────────────
//
// This is the whole idea of the reference and the reason the row is not a generic list item. On a
// video appointment the useful second action is sending the link again, not dialling — so Call is
// replaced by a filled Join in that provider's own colour, and Text becomes Text link. On a phone
// callback the primary IS the call. On an on-site job with no address the fix jumps to the front in
// amber, because a row that tells you what is wrong and does not offer the fix is a complaint.
//
// Three actions, always three, always equal width. The grid is `repeat(3, 1fr)` on a phone and
// `repeat(3, 104px)` on a desktop — fixed, never hugging content, which is what made the first
// version ragged.

interface Props {
  agenda: Agenda
  /** The employee pill's wash + ink, resolved server-side from the persona record. */
  tints: Record<string, { wash: string; ink: string }>
}

const Pin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)
const Phone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 16.9v2.6a1.6 1.6 0 0 1-1.8 1.6 16.3 16.3 0 0 1-7.1-2.5 16 16 0 0 1-5-5A16.3 16.3 0 0 1 4.6 6.5 1.6 1.6 0 0 1 6.2 4.7h2.6a1.6 1.6 0 0 1 1.6 1.4c.1.9.3 1.7.6 2.5a1.6 1.6 0 0 1-.4 1.7l-1.1 1.1a13 13 0 0 0 5 5l1.1-1.1a1.6 1.6 0 0 1 1.7-.4c.8.3 1.6.5 2.5.6a1.6 1.6 0 0 1 1.4 1.6z" />
  </svg>
)
const Msg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
  </svg>
)
const Cam = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="6" width="14" height="12" rx="3" /><path d="m16 11 6-3.5v9L16 13z" />
  </svg>
)
const Move = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="4" /><path d="M8 3v4M16 3v4M3 10h18M14 15l2 2-2 2" />
  </svg>
)
const Clock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
)
const Ex = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

const MISSING_TEXT: Record<string, string> = {
  address: 'No address yet',
  link: 'No joining link yet',
}

export function AgendaView({ agenda, tints }: Props) {
  const router = useRouter()
  const [moving, setMoving] = useState<AgendaRow | null>(null)
  const [dayOf, setDayOf] = useState<string>('')

  const day = (d: (typeof agenda.days)[number]) => (
        <div key={d.key}>
          <p className="v2-ag-grp">
            <span className="v2-ag-gt">{d.label}</span>
            <span className="v2-ag-gn">{d.count}</span>
            <span className="v2-ag-gr" />
          </p>

          <div className="v2-ag-card">
            {d.rows.map((r, i) => (
              <div key={r.id}>
                {i > 0 && <div className="v2-ag-sep" />}
                <div className="v2-ag-row" data-k={r.kind} data-now={r.isNow || undefined} data-past={r.past || undefined} data-cancelled={r.cancelled || undefined}>
                  <div className="v2-ag-time">
                    <p className="v2-ag-t1">{r.time}<i>{r.meridiem && ` ${r.meridiem}`}</i></p>
                    <p className="v2-ag-t2"><span data-short>{r.durationShort}</span><span data-long>{r.durationLong}</span></p>
                  </div>

                  {/* The spine. Its colour IS the meeting kind — amber when something is missing. */}
                  <span className="v2-ag-bar" data-pend={r.missing ? true : undefined} />

                  <div className="v2-ag-mid">
                    <div className="v2-ag-nm">
                      <span className="v2-ag-name">{r.who}</span>
                      <span
                        className="v2-ag-who"
                        style={tints[r.byPersona] ? { background: tints[r.byPersona].wash, color: tints[r.byPersona].ink } : undefined}
                      >{r.by.toUpperCase()}</span>
                      {r.isNow && <span className="v2-ag-now" data-wide>HAPPENING NOW</span>}
                      {r.cancelled && <span className="v2-ag-cx">CANCELLED</span>}
                    </div>

                    <p className="v2-ag-svc">{r.service ?? ''}</p>

                    {r.missing ? (
                      // The gap, named. Not "incomplete" — the thing that is absent.
                      <p className="v2-ag-miss">{MISSING_TEXT[r.missing]} — {r.by} asked and is waiting</p>
                    ) : r.where ? (
                      <p className="v2-ag-where" data-k={r.kind}>
                        {r.kind === 'zoom' || r.kind === 'google_meet' ? <Cam /> : r.kind === 'phone' ? <Phone /> : <Pin />}
                        {r.where}
                        {r.isNow && <span className="v2-ag-now" data-inline>· NOW</span>}
                      </p>
                    ) : (
                      // The line holds its height whether or not it has anything to say, so a row with
                      // a note and a row without are the same height. Ragged rows were the fault.
                      <p className="v2-ag-where" />
                    )}

                  </div>

                  {/* A SIBLING of .v2-ag-mid, not a child — that is what lets the track sit at the
                      row's right edge on a wide screen. On a phone the row wraps and the track takes
                      its own line, indented to clear the time rail and the spine.

                      A past appointment has no actions: there is nothing to move, and calling about a
                      job you finished last week is a different intention that belongs on the contact,
                      not here. The row keeps its shape and simply ends. */}
                  {!r.past && <Actions row={r} onMove={() => { setMoving(r); setDayOf(d.label) }} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )

  return (
    <>
      {agenda.days.map(day)}

      {/* EARLIER — the same day groups, running the other way. Not a filter: a chip that replaces the
          screen hides today to show last week, and an agenda you can point backwards stops being an
          agenda. Days simply continue downward in the direction time does. */}
      {agenda.earlier.length > 0 && (
        <div className="v2-ag-earlier">
          <p className="v2-ag-grp" data-earlier>
            <span className="v2-ag-gt">EARLIER</span>
            <span className="v2-ag-gn">{agenda.earlier.reduce((n, d) => n + d.count, 0)}</span>
            <span className="v2-ag-gr" />
          </p>
          {agenda.earlier.map(day)}
        </div>
      )}

      {moving && <MoveSheet row={moving} day={dayOf} onClose={() => setMoving(null)} onDone={() => { setMoving(null); router.refresh() }} />}
    </>
  )
}

// ── THE THREE ACTIONS ───────────────────────────────────────────────────────────────────────────

function Actions({ row, onMove }: { row: AgendaRow; onMove: () => void }) {
  const video = row.kind === 'zoom' || row.kind === 'google_meet'
  const tel = row.phone ? `tel:${row.phone}` : null
  const sms = row.phone ? `sms:${row.phone}` : null

  return (
    <div className="v2-ag-acts">
      {/* FIRST SLOT — whatever this appointment's kind makes most useful. */}
      {row.missing ? (
        <button type="button" className="v2-ag-act" data-fix disabled title={PREVIEW}>
          {row.missing === 'address' ? <Pin /> : <Cam />}
          {row.missing === 'address' ? 'Add address' : 'Add link'}
        </button>
      ) : video && row.joinUrl ? (
        <a className="v2-ag-act" data-join data-k={row.kind} href={row.joinUrl} target="_blank" rel="noreferrer"><Cam />Join</a>
      ) : row.kind === 'phone' && tel ? (
        <a className="v2-ag-act" data-join href={tel}><Phone />Call now</a>
      ) : tel ? (
        <a className="v2-ag-act" href={tel}><Phone />Call</a>
      ) : (
        <button type="button" className="v2-ag-act" disabled title="No number on this appointment"><Phone />Call</button>
      )}

      {/* SECOND — on a video appointment the useful thing is sending the link, not dialling. */}
      {row.missing && tel ? (
        <a className="v2-ag-act" href={tel}><Phone />Call</a>
      ) : sms ? (
        <a className="v2-ag-act" href={video ? `${sms}?&body=${encodeURIComponent(row.joinUrl ?? '')}` : sms}>
          <Msg />{video ? 'Text link' : 'Text'}
        </a>
      ) : (
        <button type="button" className="v2-ag-act" disabled title="No number on this appointment"><Msg />Text</button>
      )}

      <button type="button" className="v2-ag-act" data-touch onClick={onMove}><Move />Move</button>
    </div>
  )
}

// ── THE MOVE SHEET ──────────────────────────────────────────────────────────────────────────────
//
// Four options. ONE of them works: Cancel, which is the only write /api/appointments/[id] accepts
// today. The other three render disabled with the reason, which is the convention /v2 already uses —
// hiding them would hide the shape of what is coming, and a disabled control that says why is more
// honest than a control that is not there.
//
// "They'll be told" is deliberately NOT on Cancel: nothing notifies the customer when an appointment
// is cancelled. It goes back on the day something does.

function MoveSheet({ row, day, onClose, onDone }: { row: AgendaRow; day: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function cancel() {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/appointments/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'Could not cancel it.'); return }
      onDone()
    } catch {
      setErr('Could not cancel it — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="v2-ag-sheet" role="dialog" aria-modal="true" aria-label="Move this appointment">
      <button type="button" className="v2-ag-veil" aria-label="Close" onClick={onClose} disabled={busy} />
      <div className="v2-ag-panel">
        <span className="v2-ag-grab" />
        <p className="v2-ag-sh">Move this appointment</p>
        <p className="v2-ag-ss">{row.who} · {day.replace(/^(TODAY|TOMORROW) · /, '')}, {row.time} {row.meridiem}</p>

        <button type="button" className="v2-ag-opt" disabled title={PREVIEW}>
          <span className="v2-ag-ic" data-tone="violet"><Clock /></span>
          <span className="v2-ag-lab">Later today<i>Needs a route that can change the time</i></span>
          <span className="v2-ag-chev">›</span>
        </button>

        <button type="button" className="v2-ag-opt" disabled title={PREVIEW}>
          <span className="v2-ag-ic" data-tone="violet"><Move /></span>
          <span className="v2-ag-lab">Pick another day<i>Opens your availability</i></span>
          <span className="v2-ag-chev">›</span>
        </button>

        <button type="button" className="v2-ag-opt" disabled title={PREVIEW}>
          <span className="v2-ag-ic" data-tone="magenta"><Msg /></span>
          <span className="v2-ag-lab">Ask {row.by} to reschedule<i>She&apos;ll text them options and book it</i></span>
          <span className="v2-ag-chev">›</span>
        </button>

        <button type="button" className="v2-ag-opt" data-danger data-touch onClick={() => void cancel()} disabled={busy}>
          <span className="v2-ag-ic" data-tone="red"><Ex /></span>
          {/* NOT "they'll be told" — nothing notifies them yet. */}
          <span className="v2-ag-lab">{busy ? 'Cancelling…' : 'Cancel appointment'}<i>The slot frees up</i></span>
          <span className="v2-ag-chev">›</span>
        </button>

        {err && <p className="v2-ag-err">{err}</p>}
      </div>
    </div>
  )
}
