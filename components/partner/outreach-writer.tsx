'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Panel } from '@/components/partner/ui'
import { Sparkles, Copy } from 'lucide-react'

export function OutreachWriter() {
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [channel, setChannel] = useState('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function generate() {
    setBusy(true); setMessage('')
    const res = await fetch('/api/partner/coach/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche, city, channel }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    setMessage(j.message || '')
  }

  const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
  return (
    <Panel title="✍️ Personalized outreach writer">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Niche (e.g. HVAC, locksmith)" value={niche} onChange={(e) => setNiche(e.target.value)} />
          <input className={input} placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <select className={input} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">Cold email</option>
          <option value="sms">SMS</option>
        </select>
        <button onClick={generate} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">
          <Sparkles className="h-4 w-4" /> {busy ? 'Writing…' : 'Write it for me'}
        </button>
      </div>
      {message && (
        <div className="mt-3 rounded-xl border border-hairline bg-sunken/40 p-3">
          <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{message}</pre>
          <button onClick={() => { navigator.clipboard.writeText(message); toast.success('Copied') }} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-subtle hover:text-ink">
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        </div>
      )}
    </Panel>
  )
}
