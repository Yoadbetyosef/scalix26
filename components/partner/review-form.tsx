'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// Shown on a public partner profile. Only lets a signed-in customer submit; otherwise prompts login.
export function ReviewForm({ partnerSlug }: { partnerSlug: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => { createClient().auth.getUser().then(({ data }) => setSignedIn(!!data.user)) }, [])

  async function submit() {
    if (!rating) return toast.error('Pick a rating')
    setBusy(true)
    const res = await fetch('/api/marketplace/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerSlug, rating, body }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    setDone(true); toast.success('Thanks! Your review is pending approval.')
  }

  if (signedIn === null) return null
  if (done) return <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">Thanks for your review — it&apos;s pending approval.</div>
  if (!signedIn) return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-subtle">
      <a href="/auth/login" className="font-medium text-accent-strong hover:underline">Sign in</a> as a customer to leave a review.
    </div>
  )

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="mb-2 font-medium text-ink">Leave a review</div>
      <div className="mb-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} type="button"><Star className={`h-6 w-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-hairline-strong'}`} /></button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Share your experience…" className="w-full rounded-lg border border-hairline-strong p-2.5 text-sm outline-none focus:border-accent" />
      <button onClick={submit} disabled={busy} className="mt-2 h-9 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Submit review'}</button>
    </div>
  )
}
