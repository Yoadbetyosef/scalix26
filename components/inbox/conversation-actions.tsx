'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  conversationId: string
  currentStatus: string
  // Rendering context — all variants call the SAME `updateStatus` handler:
  //  'top'  → desktop top placement (default, unchanged)
  //  'bar'  → mobile bottom action bar: Resolve/Reopen only (Close lives in 'menu')
  //  'menu' → mobile info/overflow menu: Close (and Reopen) only
  place?: 'top' | 'bar' | 'menu'
  // Optional callback fired after a status update (e.g. close the info drawer).
  onAction?: () => void
}

export function ConversationActions({ conversationId, currentStatus, place = 'top', onAction }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function updateStatus(status: string) {
    setLoading(true)
    try {
      // Server API scopes the write to the validated active business (owner or operated client).
      const res = await fetch(`/api/conversations/${conversationId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      if (!res.ok) throw new Error('failed')
      toast.success(`Marked as ${status}`)
      router.refresh()
      onAction?.()
    } catch {
      toast.error('Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  // Mobile bottom action bar — Resolve (outline, beside Take Over) / Reopen.
  if (place === 'bar') {
    return (
      <>
        {currentStatus !== 'resolved' && (
          <Button variant="outline" loading={loading} onClick={() => updateStatus('resolved')} className="flex-[2] h-12">
            Resolve
          </Button>
        )}
        {currentStatus === 'closed' && (
          <Button variant="outline" loading={loading} onClick={() => updateStatus('open')} className="flex-[2] h-12">
            Reopen
          </Button>
        )}
      </>
    )
  }

  // Mobile info/overflow menu — Close (and Reopen), full-width rows, same handlers.
  if (place === 'menu') {
    return (
      <div className="flex flex-col gap-2">
        {currentStatus !== 'closed' && (
          <Button variant="ghost" loading={loading} onClick={() => updateStatus('closed')} className="w-full justify-center h-12">
            Close conversation
          </Button>
        )}
        {currentStatus !== 'open' && (
          <Button variant="outline" loading={loading} onClick={() => updateStatus('open')} className="w-full justify-center h-12">
            Reopen conversation
          </Button>
        )}
      </div>
    )
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
