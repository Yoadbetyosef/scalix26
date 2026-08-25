'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatusPill, GlassSelect } from '@/app/(v2)/v2/controls'
import { Calendar, Link2Off } from 'lucide-react'

type Status = {
  connected: boolean
  provider?: 'google' | 'microsoft'
  email?: string | null
  calendarId?: string
  calendars?: { id: string; summary: string; primary: boolean }[]
}

export function CalendarConnect({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/calendar/status')
      setStatus(res.ok ? await res.json() : { connected: false })
    } catch {
      setStatus({ connected: false })
    }
  }

  useEffect(() => {
    // One-time toast on return from the OAuth consent screen.
    const p = new URLSearchParams(window.location.search)
    if (p.get('calendar_connected')) toast.success('Calendar connected!')
    if (p.get('calendar_error')) toast.error('Could not connect calendar. Please try again.')
    load()
  }, [])

  async function selectCalendar(calendarId: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/calendar/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId }),
      })
      if (!res.ok) throw new Error()
      setStatus((s) => (s ? { ...s, calendarId } : s))
      toast.success('Calendar updated')
    } catch {
      toast.error('Could not update calendar')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      const res = await fetch('/api/calendar/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error()
      setStatus({ connected: false })
      toast.success('Calendar disconnected')
    } catch {
      toast.error('Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  const label = status?.connected ? (status.provider === 'microsoft' ? 'Outlook Calendar' : 'Google Calendar') : 'Calendar'

  return (
    <div style={{ marginTop: 18 }}>
      {/* A CONNECTION IS A ROW, not a card inside a card. This sits inside the Appointment
          Availability section, which is already a bordered surface with a header; boxing each of the
          three integrations inside it made four nested borders before a sentence. */}
      <div className="v2-grow" data-static>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><Calendar /></span>
        <span className="v2-glab">
          <b style={{ fontWeight: 550 }}>{label}</b>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
            {status === null
              ? 'Checking…'
              : !status.connected
                ? 'Connect a calendar and booked appointments become calendar events. Optional — booking works either way.'
                : <>Booked appointments are added to your calendar{status.email ? ` · ${status.email}` : ''}.</>}
          </span>
        </span>
        <span className="v2-gtrail">
          {status?.connected
            ? <StatusPill state="live">Connected</StatusPill>
            : status === null ? null : <StatusPill state="off">Not connected</StatusPill>}
        </span>
      </div>

      {status !== null && !status.connected && (
        <div className="v2-bar" style={{ marginTop: 12 }}>
          <button type="button" className="v2-act tap-target" onClick={() => { window.location.href = `/api/auth/google/calendar/connect?agentId=${encodeURIComponent(agentId)}` }}>Connect Google Calendar</button>
          <button type="button" className="v2-act tap-target" onClick={() => { window.location.href = `/api/auth/microsoft/calendar/connect?agentId=${encodeURIComponent(agentId)}` }}>Connect Outlook Calendar</button>
        </div>
      )}

      {status?.connected && (
        <>
          {status.calendars && status.calendars.length > 0 && (
            <GlassSelect
              label="Calendar for new appointments"
              value={status.calendarId || 'primary'}
              disabled={busy}
              onChange={selectCalendar}
              options={status.calendars.map((c) => ({ value: c.id, label: `${c.summary}${c.primary ? ' (primary)' : ''}` }))}
            />
          )}
          <div className="v2-bar" style={{ marginTop: 12 }}>
            <button type="button" onClick={disconnect} disabled={busy} className="v2-act tap-target" data-danger>
              <Link2Off className="w-3.5 h-3.5" /> Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  )
}
