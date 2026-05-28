'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  conversationId: string
  currentStatus: string
}

export function ConversationActions({ conversationId, currentStatus }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function updateStatus(status: string) {
    setLoading(true)
    try {
      await supabase
        .from('conversations')
        .update({ status })
        .eq('id', conversationId)
      toast.success(`Marked as ${status}`)
      router.refresh()
    } catch {
      toast.error('Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-1.5">
      {currentStatus !== 'resolved' && (
        <Button size="sm" variant="outline" loading={loading} onClick={() => updateStatus('resolved')}>
          Resolve
        </Button>
      )}
      {currentStatus !== 'closed' && (
        <Button size="sm" variant="ghost" loading={loading} onClick={() => updateStatus('closed')}>
          Close
        </Button>
      )}
      {currentStatus !== 'open' && (
        <Button size="sm" variant="outline" loading={loading} onClick={() => updateStatus('open')}>
          Reopen
        </Button>
      )}
    </div>
  )
}
