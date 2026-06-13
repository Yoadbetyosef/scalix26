'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { formatTime12 } from '@/lib/appointments'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Slot = { day_of_week: number; slot_time: string }

export function AvailabilityClient({
  tenantId,
  initialSlots,
  googleReviewUrl,
  reviewEnabled,
}: {
  tenantId: string
  initialSlots: Slot[]
  googleReviewUrl: string
  reviewEnabled: boolean
}) {
  const router = useRouter()
  const supabase = createClient()

  // times[dow] = ["09:00", "11:00", …]
  const [times, setTimes] = useState<Record<number, string[]>>(() => {
    const m: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    for (const s of initialSlots) {
      const hhmm = String(s.slot_time).slice(0, 5)
      if (!m[s.day_of_week].includes(hhmm)) m[s.day_of_week].push(hhmm)
    }
    for (const d of Object.keys(m)) m[+d].sort()
    return m
  })
  const [newTime, setNewTime] = useState<Record<number, string>>({})
  const [reviewUrl, setReviewUrl] = useState(googleReviewUrl)
  const [autoReview, setAutoReview] = useState(reviewEnabled)
  const [saving, setSaving] = useState(false)
  const [savingReview, setSavingReview] = useState(false)

  function toggleDay(dow: number, open: boolean) {
    setTimes((t) => ({ ...t, [dow]: open ? (t[dow].length ? t[dow] : ['09:00']) : [] }))
  }
  function addTime(dow: number) {
    const v = newTime[dow]
    if (!v) return
    setTimes((t) => (t[dow].includes(v) ? t : { ...t, [dow]: [...t[dow], v].sort() }))
    setNewTime((n) => ({ ...n, [dow]: '' }))
  }
  function removeTime(dow: number, v: string) {
    setTimes((t) => ({ ...t, [dow]: t[dow].filter((x) => x !== v) }))
  }

  async function saveAvailability() {
    setSaving(true)
    try {
      await supabase.from('appointment_slots').delete().eq('tenant_id', tenantId)
      const rows: { tenant_id: string; day_of_week: number; slot_time: string; is_active: boolean }[] = []
      for (let d = 0; d < 7; d++) for (const t of times[d]) rows.push({ tenant_id: tenantId, day_of_week: d, slot_time: t, is_active: true })
      if (rows.length) {
        const { error } = await supabase.from('appointment_slots').insert(rows)
        if (error) throw error
      }
      toast.success('Availability saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save availability')
    } finally {
      setSaving(false)
    }
  }

  async function saveReviews() {
    setSavingReview(true)
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ google_review_url: reviewUrl.trim() || null, review_automation_enabled: autoReview })
        .eq('id', tenantId)
      if (error) throw error
      toast.success('Review settings saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingReview(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Availability</h1>
          <p className="text-sm text-gray-500 mt-0.5">Set the appointment times the AI can book.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Weekly Hours</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {DAYS.map((label, dow) => {
            const open = times[dow].length > 0
            return (
              <div key={dow} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{label}</span>
                  <button
                    type="button"
                    onClick={() => toggleDay(dow, !open)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full ${open ? 'bg-[#4ecdc4]/15 text-[#3db8af]' : 'bg-gray-100 text-gray-400'}`}
                  >
                    {open ? 'Open' : 'Closed'}
                  </button>
                </div>
                {open && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {times[dow].map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full pl-3 pr-1 py-1 text-xs">
                        {formatTime12(t)}
                        <button type="button" onClick={() => removeTime(dow, t)} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="time"
                        value={newTime[dow] || ''}
                        onChange={(e) => setNewTime((n) => ({ ...n, [dow]: e.target.value }))}
                        className="text-xs border border-gray-200 rounded-md px-2 py-1"
                      />
                      <button type="button" onClick={() => addTime(dow)} className="text-[#4ecdc4] hover:text-[#3db8af]"><Plus className="w-4 h-4" /></button>
                    </span>
                  </div>
                )}
              </div>
            )
          })}
          <Button onClick={saveAvailability} loading={saving} className="w-full sm:w-auto">Save Availability</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Google Reviews</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Google review link</Label>
            <Input className="mt-1.5" placeholder="https://g.page/r/..." value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={autoReview} onChange={(e) => setAutoReview(e.target.checked)} className="accent-[#4ecdc4] w-4 h-4" />
            Auto-send a review request 3 hours after each appointment
          </label>
          <Button onClick={saveReviews} loading={savingReview} className="w-full sm:w-auto">Save Review Settings</Button>
        </CardContent>
      </Card>
    </div>
  )
}
