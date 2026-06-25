'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Calendar, Check, Link2Off } from 'lucide-react'

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

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-600" />
        <span className="font-semibold text-gray-800 text-sm">{status?.connected ? (status.provider === 'microsoft' ? 'Outlook Calendar' : 'Google Calendar') : 'Calendar'}</span>
        {status?.connected && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" /> Connected
          </span>
        )}
      </div>

      {status === null ? (
        <p className="text-xs text-gray-400 mt-2">Checking…</p>
      ) : !status.connected ? (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-3">Connect a calendar to automatically add booked appointments as calendar events. Optional — booking works either way.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = `/api/auth/google/calendar/connect?agentId=${encodeURIComponent(agentId)}` }}>
              Connect Google Calendar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = `/api/auth/microsoft/calendar/connect?agentId=${encodeURIComponent(agentId)}` }}>
              Connect Outlook Calendar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-gray-500">
            Booked appointments are added to your calendar{status.email ? <> · <span className="text-gray-700">{status.email}</span></> : null}.
          </p>
          {status.calendars && status.calendars.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Calendar for new appointments</label>
              <select
                value={status.calendarId || 'primary'}
                disabled={busy}
                onChange={(e) => selectCalendar(e.target.value)}
                className="h-10 w-full max-w-xs rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-[#4ecdc4] focus:outline-none focus:ring-1 focus:ring-[#4ecdc4]"
              >
                {status.calendars.map((c) => (
                  <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            <Link2Off className="w-3.5 h-3.5 mr-1.5" /> Disconnect
          </Button>
        </div>
      )}
    </div>
  )
}
