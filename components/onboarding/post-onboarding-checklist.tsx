'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  slug: string
  aiPhoneNumber: string | null
  initial: Record<string, boolean>
}

export function PostOnboardingChecklist({ slug, aiPhoneNumber, initial }: Props) {
  const [state, setState] = useState<Record<string, boolean>>(initial || {})
  const [sending, setSending] = useState(false)
  // Use the brand domain the user is actually on so the shared booking link never
  // leaks the wrong brand. Env value first (SSR-safe), then the real origin on mount.
  const [appUrl, setAppUrl] = useState(process.env.NEXT_PUBLIC_APP_URL || '')
  useEffect(() => { setAppUrl(window.location.origin) }, [])
  const bookingUrl = `${appUrl}/f/${slug}`

  function mark(item: string) {
    setState(s => ({ ...s, [item]: true }))
    fetch('/api/onboarding/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item }),
    }).catch(() => {})
  }

  function copyLink() {
    navigator.clipboard.writeText(bookingUrl)
      .then(() => { toast.success('Booking link copied!'); mark('shared') })
      .catch(() => toast.error('Copy failed'))
  }

  async function sendTest() {
    setSending(true)
    try {
      const res = await fetch('/api/onboarding/test-sms', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to send')
      toast.success('Test message sent to your phone!')
      setState(s => ({ ...s, tested: true }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // Hide once the actionable items are all done
  if (state.called && state.shared && state.tested) return null

  const items = [
    { key: 'ai_live', done: true, label: 'Your AI is live', action: null as React.ReactNode },
    {
      key: 'called',
      done: !!state.called,
      label: 'Call your AI to hear it in action',
      action: aiPhoneNumber ? (
        <a href={`tel:${aiPhoneNumber}`} onClick={() => mark('called')}>
          <Button size="sm" variant="outline">Call Now</Button>
        </a>
      ) : null,
    },
    {
      key: 'shared',
      done: !!state.shared,
      label: 'Share your booking link',
      action: <Button size="sm" variant="outline" onClick={copyLink}>Copy Link</Button>,
    },
    {
      key: 'tested',
      done: !!state.tested,
      label: 'Send your first test message',
      // Only once a number exists — a numberless test SMS would fail.
      action: aiPhoneNumber ? <Button size="sm" variant="outline" loading={sending} onClick={sendTest}>Send Test SMS</Button> : null,
    },
  ]

  const doneCount = items.filter(i => i.done).length

  return (
    <div className="bg-white rounded-2xl border border-[#5B6CF0]/30 shadow-sm overflow-hidden">
      <div className="bg-[#5B6CF0]/10 px-4 sm:px-5 py-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#5B6CF0] flex-shrink-0" />
        <p className="text-sm font-semibold text-gray-900">Get started — {doneCount}/4 done</p>
      </div>
      <div className="divide-y divide-gray-50">
        {items.map(it => (
          <div key={it.key} className="flex items-center gap-3 px-4 sm:px-5 py-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${it.done ? 'bg-green-500 text-white' : 'border-2 border-gray-200'}`}>
              {it.done && <Check className="w-3.5 h-3.5" />}
            </div>
            <p className={`flex-1 min-w-0 text-sm ${it.done ? 'text-gray-400 line-through' : 'text-gray-800 font-medium'}`}>{it.label}</p>
            {!it.done && it.action && <div className="flex-shrink-0">{it.action}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
