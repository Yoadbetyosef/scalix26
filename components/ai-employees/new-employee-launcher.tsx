'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

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
      <div className="p-6 max-w-xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">{error}</p>
          <div className="mt-4 flex gap-2 justify-center">
            <Link href="/ai-employees"><Button variant="outline" size="sm">Back</Button></Link>
            <Link href="/settings#billing"><Button size="sm">Upgrade plan</Button></Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <Loader2 className="w-8 h-8 text-[#4ecdc4] animate-spin" />
      <p className="text-sm text-gray-600 mt-3">Setting up your new AI employee and its number…</p>
    </div>
  )
}
