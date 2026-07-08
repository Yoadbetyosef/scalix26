'use client'

import { useState } from 'react'
import { Panel } from '@/components/partner/ui'
import { Calculator, Copy } from 'lucide-react'
import { toast } from 'sonner'

// A partner sales tool: show a prospect the revenue they lose to missed calls, and what Scalix26
// recovers. Pure client-side math — no data needed.
export function RoiCalculator() {
  const [missedPerWeek, setMissed] = useState(10)
  const [jobValue, setJobValue] = useState(250)
  const [closeRate, setCloseRate] = useState(40)

  const recoveredJobsPerMonth = (missedPerWeek * 4.33) * (closeRate / 100)
  const recoveredRevenue = Math.round(recoveredJobsPerMonth * jobValue)
  const annual = recoveredRevenue * 12

  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const pitch = `Missing ~${missedPerWeek} calls/week at a ${money(jobValue)} average job and ${closeRate}% close rate = about ${money(recoveredRevenue)}/month (${money(annual)}/year) in recoverable revenue. Scalix26's AI answers every call 24/7 so you stop losing it.`

  const field = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Calculator className="h-4 w-4" /> ROI Calculator</span>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Missed calls / week</span>
            <input type="number" className={field} value={missedPerWeek} onChange={(e) => setMissed(Math.max(0, Number(e.target.value)))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Average job value ($)</span>
            <input type="number" className={field} value={jobValue} onChange={(e) => setJobValue(Math.max(0, Number(e.target.value)))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Close rate (%)</span>
            <input type="number" className={field} value={closeRate} onChange={(e) => setCloseRate(Math.min(100, Math.max(0, Number(e.target.value))))} /></label>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-accent/5 p-4 text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-subtle">Recoverable revenue</div>
          <div className="mt-1 text-3xl font-bold text-accent-strong">{money(recoveredRevenue)}<span className="text-base font-medium text-subtle">/mo</span></div>
          <div className="text-sm text-subtle">{money(annual)}/year</div>
          <button onClick={() => { navigator.clipboard.writeText(pitch); toast.success('Pitch copied') }} className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-xs font-medium text-subtle hover:text-ink">
            <Copy className="h-3.5 w-3.5" /> Copy the pitch
          </button>
        </div>
      </div>
    </Panel>
  )
}
