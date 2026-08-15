'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// STOP FOLLOW-UPS — named for what it does, and shown only when there is something to stop.
//
// This is "Dismiss" from the leads screen, moved to where the decision is informed and renamed to
// the thing it actually controls: an outbound SMS sequence, not a filing state. The count is in the
// label because "stop follow-ups" on a thread with none is a control that does nothing, and this
// component is not rendered at all in that case.
//
// It sits beside Resolve and Close as a third secondary action. It is not the primary thing on this
// screen — taking over is — so it wears the same quiet treatment they do.

export function StopFollowUps({ conversationId, count }: { conversationId: string; count: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  async function stop() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/stop-followups`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      // The route's own sentence, verbatim — it is already written in the owner's words. Never a
      // success claim assembled here from a status code.
      setDone(res.ok ? (j.note || 'Follow-ups stopped.') : (j.error || 'Could not stop them.'))
      if (res.ok) router.refresh()
    } catch {
      setDone('Could not stop them — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (done) return <span className="v2-sec" data-static>{done}</span>

  return (
    <button type="button" className="v2-sec" data-touch disabled={busy} onClick={stop}>
      {busy ? 'Stopping…' : `Stop follow-ups${count > 1 ? ` (${count})` : ''}`}
    </button>
  )
}
