'use client'

import { useState } from 'react'
import { Calendar, Check, BellOff, Phone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatTime12 } from '@/lib/appointments'

export type Appointment = {
  id: string
  customer_name: string | null
  customer_phone: string
  slot_date: string
  slot_time: string
  service_type: string | null
  status: 'confirmed' | 'cancelled' | 'completed'
  skip_review: boolean | null
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
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
    const supabase = createClient()
    const { error } = await supabase.from('appointments').update({ status: 'completed' }).eq('id', id)
    if (!error) { setRows((r) => r.map((a) => (a.id === id ? { ...a, status: 'completed' } : a))); router.refresh() }
    setBusy(null)
  }
  async function skipReview(id: string) {
    setBusy(id)
    const supabase = createClient()
    const { error } = await supabase.from('appointments').update({ skip_review: true }).eq('id', id)
    if (!error) { setRows((r) => r.map((a) => (a.id === id ? { ...a, skip_review: true } : a))); router.refresh() }
    setBusy(null)
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 bg-white rounded-xl border border-gray-100 shadow-sm">
        <Calendar className="w-12 h-12 mb-3" />
        <p className="text-sm">No appointments yet</p>
        <p className="text-xs text-gray-400 mt-1 text-center px-4">Appointments booked by the AI appear here. Set your times in Settings → Availability.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-sm font-medium">
        <span className="text-blue-600">📅 {counts.today} Today</span>
        <span className="text-green-600">✅ {counts.completed} Completed</span>
        <span className="text-gray-500">⏳ {counts.upcoming} Upcoming</span>
      </div>

      <div className="space-y-2">
        {rows.map((a) => {
          const cfg = STATUS_STYLES[a.status] || STATUS_STYLES.confirmed
          return (
            <div key={a.id} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 truncate">{a.customer_name || 'Customer'}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cfg}`}>{a.status}</span>
                    {a.skip_review && <span className="text-[11px] text-gray-400">review skipped</span>}
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{friendlyDate(a.slot_date)} · {formatTime12(a.slot_time)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.service_type || 'Service'} · {a.customer_phone}</p>
                </div>
                <div className="flex flex-col items-stretch gap-2 flex-shrink-0">
                  <a href={`tel:${a.customer_phone}`} className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4ecdc4] text-white hover:bg-[#3db8af]">
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                  {a.status !== 'completed' && (
                    <button onClick={() => markCompleted(a.id)} disabled={busy === a.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> {busy === a.id ? '…' : 'Mark Completed'}
                    </button>
                  )}
                  {!a.skip_review && (
                    <button onClick={() => skipReview(a.id)} disabled={busy === a.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                      <BellOff className="w-3.5 h-3.5" /> Skip Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
