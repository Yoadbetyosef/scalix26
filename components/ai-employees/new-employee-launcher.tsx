'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { AiThinking } from '@/components/brand/ai-thinking'

// New Employee uses the SAME full edit page as onboarding: create + provision a number
// behind a brief spinner, then land on /ai-employees/{id}?onboarding=1. No confirm
// step, no wizard — the full edit page IS the experience. Plan-gated (no number bought
// when over the limit).
export function NewEmployeeLauncher() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // single-fire (guards React strict-mode double-invoke)
    started.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/agents/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.status === 403) { setError(json.error || 'You’ve reached your plan’s employee limit.'); return }
        if (!res.ok || !json.employeeId) throw new Error()
        router.replace(`/ai-employees/${json.employeeId}?onboarding=1`)
      } catch {
        setError('Could not create the employee — please try again.')
      }
    })()
  }, [router])

  if (error) {
    return (
      <div className="v2 v2-embedded p-4 sm:p-6 max-w-xl mx-auto">
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start' }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {error}
            <span className="v2-bar" style={{ marginTop: 12 }}>
              <Link href="/ai-employees" className="v2-act tap-target">Back</Link>
              <Link href="/settings#billing" className="v2-act tap-target" data-solid>Upgrade plan</Link>
            </span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center sx-animate-in">
      <AiThinking label="Preparing your AI employee and its phone number…" />
    </div>
  )
}
