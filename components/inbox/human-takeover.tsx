'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserCog, Bot } from 'lucide-react'

interface Props {
  conversationId: string
  active: boolean
  // Mobile bottom-bar rendering: primary dark filled button, taller, flex-grow.
  // Same handler (`toggle`) as the desktop button — styling only.
  mobileBar?: boolean
}

export function HumanTakeover({ conversationId, active, mobileBar = false }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function toggle(enabled: boolean) {
    setLoading(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error()
      toast.success(enabled ? 'You are now handling this conversation' : 'AI re-enabled for this conversation')
      router.refresh()
    } catch {
      toast.error('Failed to update')
    } finally {
      setLoading(false)
    }
  }

  // The kit's .v2-act. Taking over is the one verb on this screen that changes who is answering, so
  // in the mobile bar it is the filled pill; everywhere else the hollow one. Handing the conversation
  // back is never the filled state — the AI answering is the resting condition, not an action to sell.
  const label = active ? 'Return to AI' : 'Take Over'
  const Icon = active ? Bot : UserCog

  if (mobileBar) {
    return (
      <button className="v2-act" data-wide data-solid={!active || undefined} disabled={loading} onClick={() => toggle(!active)}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    )
  }

  return (
    <button className="v2-act" disabled={loading} onClick={() => toggle(!active)}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}
