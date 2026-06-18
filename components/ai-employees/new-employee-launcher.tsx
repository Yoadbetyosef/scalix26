'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Bot, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

// "Create another AI employee" — same experience as onboarding: create + provision a
// number via the gated endpoint, then land on the agent's edit page in onboarding
// mode. Replaces the old separate 5-step wizard.
export function NewEmployeeLauncher() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [limit, setLimit] = useState<string | null>(null)

  async function create() {
    setCreating(true)
    setLimit(null)
    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 403) { setLimit(json.error || 'You’ve reached your plan’s employee limit.'); setCreating(false); return }
      if (!res.ok || !json.employeeId) throw new Error()
      router.push(`/ai-employees/${json.employeeId}?onboarding=1`)
    } catch {
      toast.error('Could not create the employee — please try again')
      setCreating(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <Link href="/ai-employees">
        <Button variant="ghost" size="sm" className="mb-4"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
      </Link>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#4ecdc4]/10 flex items-center justify-center mx-auto mb-4">
          <Bot className="w-6 h-6 text-[#4ecdc4]" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Add another AI employee</h1>
        <p className="text-sm text-gray-500 mt-2">
          Each employee is its own business — it gets its own phone number. We’ll set it up, then you customize everything (voice, identity, channels, skills) on its page.
        </p>
        {limit ? (
          <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            {limit}
            <div className="mt-3"><Link href="/settings#billing"><Button size="sm">Upgrade plan</Button></Link></div>
          </div>
        ) : (
          <Button className="mt-5" loading={creating} onClick={create}>Create my AI employee</Button>
        )}
      </div>
    </div>
  )
}
