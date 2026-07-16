'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewDraftButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/commerce/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const j = await r.json()
      if (r.ok && j.draft?.id) router.push(`/commerce/drafts/${j.draft.id}`)
      else setBusy(false)
    } catch { setBusy(false) }
  }
  return <button onClick={create} disabled={busy} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Creating…' : '+ New draft'}</button>
}
