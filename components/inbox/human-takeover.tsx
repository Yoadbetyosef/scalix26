'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserCog, Bot } from 'lucide-react'

interface Props {
  conversationId: string
  active: boolean
}

export function HumanTakeover({ conversationId, active }: Props) {
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
