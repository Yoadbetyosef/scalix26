'use client'

import { useEffect, useState } from 'react'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { CountUp } from '@/components/ui/count-up'

// W4 — the once-a-week "win moment" (Monzo pattern). Full-screen takeover on the first
// dashboard open of the week, using ONLY the recovered-this-week metric already fetched.
// Skipped entirely when the value is 0. Persisted via localStorage (scalix_weekly_win).
const KEY = 'scalix_weekly_win'

function startOfWeek(): number {
  const d = new Date()
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysSinceMonday)
  return d.getTime()
}

export function WeeklyWin({ count, name, voice }: { count: number; name: string; voice?: string | null }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (count <= 0) return
    let last = 0
    try { last = parseInt(localStorage.getItem(KEY) || '0', 10) || 0 } catch { /* ignore */ }
    if (last >= startOfWeek()) return // already shown this week
    setShow(true)
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* quota */ }
  }, [count])

  if (!show) return null

  const summary = `${name} recovered ${count} conversation${count === 1 ? '' : 's'} for me this week on Scalix.`
  const onShare = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) await navigator.share({ text: summary })
      else if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(summary)
    } catch { /* user cancelled / unsupported */ }
  }

  return (
    <div className="sx-win-in fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 bg-[#0a0e1e] px-6 text-center text-white">
      <div className="h-20 w-20">
        <EmployeeAvatar name={name} voice={voice} status="on_duty" size="lg" showStatus={false} />
      </div>
      <p className="text-sm font-medium uppercase tracking-[0.14em] text-white/50">This week</p>
      <p className="sx-tabular text-7xl font-semibold leading-none"><CountUp value={count} duration={1200} /></p>
      <p className="max-w-xs text-lg font-light leading-snug text-white/90">
        {name} recovered {count} conversation{count === 1 ? '' : 's'} for you this week
      </p>
      <div className="mt-3 flex gap-3">
        <button onClick={() => setShow(false)} className="rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-ink transition-transform active:scale-95 [-webkit-tap-highlight-color:transparent]">Nice</button>
        <button onClick={onShare} className="rounded-full bg-white/15 px-7 py-3.5 text-sm font-semibold text-white transition-transform hover:bg-white/25 active:scale-95 [-webkit-tap-highlight-color:transparent]">Share</button>
      </div>
    </div>
  )
}
