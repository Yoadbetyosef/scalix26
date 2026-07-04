'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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

  if (mobileBar) {
    // Primary dark filled, ~60% width (flex-[3] beside Resolve's flex-[2]), 48px tall.
    return (
      <Button
        variant={active ? 'outline' : 'default'}
        loading={loading}
        onClick={() => toggle(!active)}
        className="flex-[3] h-12"
      >
        {!loading && (active ? <Bot className="w-4 h-4 mr-1.5" /> : <UserCog className="w-4 h-4 mr-1.5" />)}
        {active ? 'Return to AI' : 'Take Over'}
      </Button>
    )
  }

  if (active) {
    return (
      <Button size="sm" variant="outline" loading={loading} onClick={() => toggle(false)}>
        {!loading && <Bot className="w-4 h-4 mr-1.5" />}
        Return to AI
      </Button>
    )
  }

  return (
    <Button size="sm" variant="outline" loading={loading} onClick={() => toggle(true)}>
      {!loading && <UserCog className="w-4 h-4 mr-1.5" />}
      Take Over
    </Button>
  )
}
