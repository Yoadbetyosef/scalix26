'use client'

import { useState } from 'react'
import { Calendar, Check, BellOff, Phone, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { EmptyState } from '@/components/ui/empty-state'
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

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-sunken text-subtle',
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
      <EmptyState icon={Calendar} title="Ready to start booking">
        Your AI is standing by to book appointments the moment a customer asks — they&rsquo;ll land here automatically, with no back-and-forth.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2 sx-card px-5 py-3.5 text-sm">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-400" /><span className="sx-tabular font-medium text-ink">{counts.today}</span><span className="text-subtle">Today</span></span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="sx-tabular font-medium text-ink">{counts.completed}</span><span className="text-subtle">Completed</span></span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="sx-tabular font-medium text-ink">{counts.upcoming}</span><span className="text-subtle">Upcoming</span></span>
      </div>

      <div className="space-y-2">
        {rows.map((a) => {
          const cfg = STATUS_STYLES[a.status] || STATUS_STYLES.confirmed
          return (
            <div key={a.id} className="rounded-2xl border border-hairline bg-white shadow-e1 p-4 sm:p-5 transition-all hover:shadow-e2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink truncate">{a.customer_name || 'Customer'}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cfg}`}>{a.status}</span>
                    {a.skip_review && <span className="text-[11px] text-muted">review skipped</span>}
                  </div>
                  <p className="text-sm text-ink mt-1">{friendlyDate(a.slot_date)} · {formatTime12(a.slot_time)}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {a.service_type || 'Service'} · {a.customer_phone}
                    {a.channel && <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-sunken text-subtle capitalize">{a.channel}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-stretch gap-2 flex-shrink-0">
                  <a href={`tel:${a.customer_phone}`} className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink text-white hover:bg-ink/90">
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                  {a.status !== 'completed' && (
                    <button onClick={() => markCompleted(a.id)} disabled={busy === a.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-hairline-strong text-ink shadow-e1 hover:bg-sunken hover:shadow-e2 transition-all disabled:opacity-50">
                      <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2.5} /> {busy === a.id ? '…' : 'Mark Completed'}
                    </button>
                  )}
                  {a.review_sent_at ? (
                    <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium text-green-600">
                      <Star className="w-3.5 h-3.5 fill-current" /> Review sent
                    </span>
                  ) : (
                    <button onClick={() => sendReview(a.id)} disabled={busy === a.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-hairline-strong text-ink shadow-e1 hover:bg-sunken hover:shadow-e2 transition-all disabled:opacity-50">
                      <Star className="w-3.5 h-3.5 text-amber-500" /> {busy === a.id ? '…' : 'Send Review Now'}
                    </button>
                  )}
                  {!a.skip_review && !a.review_sent_at && (
                    <button onClick={() => skipReview(a.id)} disabled={busy === a.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-muted hover:text-subtle hover:bg-sunken disabled:opacity-50">
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
