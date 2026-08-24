'use client'

import { useState } from 'react'
import { Check, BellOff, Phone, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { formatTime12 } from '@/lib/appointments'

export type Appointment = {
  id: string
  customer_name: string | null
  customer_phone: string
  customer_email: string | null
  channel: string | null
  slot_date: string
  slot_time: string
  service_type: string | null
  status: 'confirmed' | 'cancelled' | 'completed'
  skip_review: boolean | null
  review_sent_at: string | null
}

// Status wears the kit's chip in its own hue — the same three-value pattern /inbox/[id] uses for a
// conversation. Confirmed is the live one, completed the settled one, cancelled the muted one.
const STATUS_HUE: Record<string, string> = {
  confirmed: 'var(--v2-t1)',
  completed: 'var(--v2-t2)',
  cancelled: 'var(--v2-mute)',
}

function friendlyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

export function AppointmentsTable({ appointments }: { appointments: Appointment[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Appointment[]>(appointments)
  const [busy, setBusy] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const counts = {
    today: rows.filter((a) => a.slot_date === today && a.status !== 'cancelled').length,
    completed: rows.filter((a) => a.status === 'completed').length,
    upcoming: rows.filter((a) => a.slot_date > today && a.status === 'confirmed').length,
  }

  async function markCompleted(id: string) {
    setBusy(id)
    // Server API scopes the write to the validated active business (owner or operated client).
    const res = await fetch(`/api/appointments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })
    if (res.ok) { setRows((r) => r.map((a) => (a.id === id ? { ...a, status: 'completed' } : a))); router.refresh() }
    setBusy(null)
  }
  async function skipReview(id: string) {
    setBusy(id)
    const res = await fetch(`/api/appointments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip_review: true }) })
    if (res.ok) { setRows((r) => r.map((a) => (a.id === id ? { ...a, skip_review: true } : a))); router.refresh() }
    setBusy(null)
  }
  async function sendReview(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/appointments/${id}/review`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Review request sent')
        setRows((r) => r.map((a) => (a.id === id ? { ...a, review_sent_at: new Date().toISOString() } : a)))
      } else {
        toast.error(data.error === 'no google_review_url' ? 'Add your Google review link in Settings → Availability' : 'Could not send review')
      }
    } catch {
      toast.error('Could not send review')
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) {
    return (
      <div className="v2 v2-embedded">
        <div className="v2-card" data-empty>
          <b>Ready to start booking</b>
          <span>Your AI is standing by to book appointments the moment a customer asks — they&rsquo;ll land here automatically, with no back-and-forth.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="v2 v2-embedded">
      {/* The header the page never had. /appointments was created by moving the dashboard's tab
          here, and a tab has no title — so the count went into the micro-label, where the rail
          cannot say it, and the three tallies followed as chips rather than as a bordered stat bar
          with its own three dot colours. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Schedule · {rows.length}</p>
        <s />
        <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t1)' }}>{counts.today} today</span>
        <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>{counts.completed} completed</span>
        <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>{counts.upcoming} upcoming</span>
      </div>

      <div className="v2-list sx-stagger">
        {rows.map((a) => (
          /* The kit's list row. v1 gave each appointment a shadowed card with a four-button column
             stacked down its right side, which on a phone is a card taller than it is wide. The row
             lights from the left in the status's own hue and the actions are the kit's pills. */
          <div key={a.id} className="v2-row" style={{ ['--chan' as string]: STATUS_HUE[a.status] ?? 'var(--v2-t1)' }}>
            <div className="v2-m">
              <p className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="truncate">{a.customer_name || 'Customer'}</span>
                <span className="v2-stat">{a.status}</span>
                {a.channel && <span className="v2-kick">{a.channel}</span>}
                {/* A chip, not a second micro-label: side by side, two v2-kicks read as one phrase —
                    "OWNER REVIEW SKIPPED" — and one of these is where the booking came from while
                    the other is a decision somebody made. */}
                {a.skip_review && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>review skipped</span>}
              </p>
              <span>
                {friendlyDate(a.slot_date)} · {formatTime12(a.slot_time)} · {a.service_type || 'Service'} · {a.customer_phone}
              </span>
            </div>
            <div className="v2-bar" style={{ flex: 'none', justifyContent: 'flex-end' }}>
              <a href={`tel:${a.customer_phone}`} className="v2-act" data-solid data-touch>
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
              {a.status !== 'completed' && (
                <button onClick={() => markCompleted(a.id)} disabled={busy === a.id} className="v2-act" data-touch>
                  <Check className="w-3.5 h-3.5" /> {busy === a.id ? 'Working' : 'Completed'}
                </button>
              )}
              {a.review_sent_at ? (
                <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>
                  <Star className="w-3 h-3" /> Review sent
                </span>
              ) : (
                <button onClick={() => sendReview(a.id)} disabled={busy === a.id} className="v2-act" data-touch>
                  <Star className="w-3.5 h-3.5" /> {busy === a.id ? 'Working' : 'Send review'}
                </button>
              )}
              {!a.skip_review && !a.review_sent_at && (
                <button onClick={() => skipReview(a.id)} disabled={busy === a.id} className="v2-act" data-touch>
                  <BellOff className="w-3.5 h-3.5" /> Skip
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
