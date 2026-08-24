'use client'

import { useState } from 'react'
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

  // The kit's .v2-act throughout — same three verbs, same handlers, same placements. A status verb
  // is not a destination, so it stays the pill: hollow for the secondary ones, filled only where the
  // bottom bar's primary already was.
  if (place === 'bar') {
    return (
      <>
        {currentStatus !== 'resolved' && (
          <button className="v2-act" data-wide disabled={loading} onClick={() => updateStatus('resolved')}>
            Resolve
          </button>
        )}
        {currentStatus === 'closed' && (
          <button className="v2-act" data-wide disabled={loading} onClick={() => updateStatus('open')}>
            Reopen
          </button>
        )}
      </>
    )
  }

  // Mobile info/overflow menu — Close (and Reopen), full-width rows, same handlers.
  if (place === 'menu') {
    return (
      <div className="flex flex-col gap-2">
        {currentStatus !== 'closed' && (
          <button className="v2-act" data-wide disabled={loading} onClick={() => updateStatus('closed')}>
            Close conversation
          </button>
        )}
        {currentStatus !== 'open' && (
          <button className="v2-act" data-wide disabled={loading} onClick={() => updateStatus('open')}>
            Reopen conversation
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-1.5">
      {currentStatus !== 'resolved' && (
        <button className="v2-act" disabled={loading} onClick={() => updateStatus('resolved')}>
          Resolve
        </button>
      )}
      {currentStatus !== 'closed' && (
        <button className="v2-act" disabled={loading} onClick={() => updateStatus('closed')}>
          Close
        </button>
      )}
      {currentStatus !== 'open' && (
        <button className="v2-act" disabled={loading} onClick={() => updateStatus('open')}>
          Reopen
        </button>
      )}
    </div>
  )
}
