'use client'

import { useState } from 'react'
import { Panel } from '@/components/partner/ui'
import { Calculator, Copy } from 'lucide-react'
import { toast } from 'sonner'

// A partner sales tool: quantify the revenue a business captures when an always-on AI employee
// handles every call, text and message, and follows up on every lead. Pure client-side math.
export function RoiCalculator() {
  const [leadsPerWeek, setLeads] = useState(10)
  const [jobValue, setJobValue] = useState(250)
  const [closeRate, setCloseRate] = useState(40)

  // Opportunities today that go unanswered, slow-answered, or un-followed-up — recovered by a 24/7
  // AI employee that responds instantly and follows up every time.
  const capturedPerMonth = (leadsPerWeek * 4.33) * (closeRate / 100)
  const capturedRevenue = Math.round(capturedPerMonth * jobValue)
  const annual = capturedRevenue * 12

  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const pitch = `With ~${leadsPerWeek} leads/week at a ${money(jobValue)} average value and a ${closeRate}% close rate, an AI employee that answers instantly 24/7 and follows up with every lead captures about ${money(capturedRevenue)}/month (${money(annual)}/year) you'd otherwise leave on the table. Scalix26 learns your business, handles every call, text and message, and tells you what to do next.`

  const field = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Calculator className="h-4 w-4" /> Revenue Impact Calculator</span>}>
      <p className="mb-4 text-sm text-subtle">Show a prospect what an always-on AI employee is worth — the revenue captured by responding instantly and following up on every lead, day and night.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">New leads / week</span>
            <input type="number" className={field} value={leadsPerWeek} onChange={(e) => setLeads(Math.max(0, Number(e.target.value)))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Average job / customer value ($)</span>
            <input type="number" className={field} value={jobValue} onChange={(e) => setJobValue(Math.max(0, Number(e.target.value)))} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Close rate (%)</span>
            <input type="number" className={field} value={closeRate} onChange={(e) => setCloseRate(Math.min(100, Math.max(0, Number(e.target.value))))} /></label>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-accent/5 p-4 text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-subtle">Revenue captured</div>
          <div className="mt-1 text-3xl font-bold text-accent-strong">{money(capturedRevenue)}<span className="text-base font-medium text-subtle">/mo</span></div>
          <div className="text-sm text-subtle">{money(annual)}/year</div>
          <button onClick={() => { navigator.clipboard.writeText(pitch); toast.success('Pitch copied') }} className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-xs font-medium text-subtle hover:text-ink">
            <Copy className="h-3.5 w-3.5" /> Copy the pitch
          </button>
        </div>
      </div>
    </Panel>
  )
}
