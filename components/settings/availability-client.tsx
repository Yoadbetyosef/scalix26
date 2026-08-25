'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Star } from 'lucide-react'
import { GlassInput, GlassToggle } from '@/app/(v2)/v2/controls'

// Weekly Hours now live on the AI employee page (Weekly Hours section), backed by
// the appointment_slots table — the single source of truth the booking logic reads.
// This component only handles Google Reviews now.
export function AvailabilityClient({
  tenantId,
  googleReviewUrl,
  reviewEnabled,
  embedded = false,
}: {
  tenantId: string
  googleReviewUrl: string
  reviewEnabled: boolean
  embedded?: boolean
}) {
  const router = useRouter()

  const [reviewUrl, setReviewUrl] = useState(googleReviewUrl)
  const [autoReview, setAutoReview] = useState(reviewEnabled)
  const [savingReview, setSavingReview] = useState(false)

  async function saveReviews() {
    setSavingReview(true)
    try {
      // Server API scopes the write to the validated active business (owner or operated client).
      const res = await fetch('/api/settings/reviews', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ google_review_url: reviewUrl.trim() || null, review_automation_enabled: autoReview }) })
      if (!res.ok) throw new Error('failed')
      toast.success('Review settings saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingReview(false)
    }
  }

  // MIGRATED WHOLE, not just the embedded half. This renders in two places — inside the AI employee
  // screen and as the standalone /settings Reviews page — and reskinning only the embedded branch
  // would have put a v2 section inside v1 page chrome. The standalone route was not in this pass's
  // scope; it is thirty lines and finishing it was cheaper than leaving a mixed screen behind.
  const content = (
    <section className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
      <p className="v2-ghead"><i />Google reviews<s /></p>
      <div className="v2-gcard">
        <div className="v2-grow" data-static>
          <span className="v2-gchip"><Star /></span>
          <span className="v2-glab">A review request goes out after the job is done, from your own number, with your link in it.</span>
        </div>
        <GlassInput
          label="Google review link"
          value={reviewUrl}
          onChange={setReviewUrl}
          placeholder="https://g.page/r/…"
        />
        <GlassToggle
          label="Send automatically"
          hint="Three hours after each appointment."
          checked={autoReview}
          onChange={setAutoReview}
        />
        <div className="v2-bar" style={{ padding: '0 12px 12px' }}>
          <button type="button" onClick={saveReviews} disabled={savingReview} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
            {savingReview ? 'Saving…' : 'Save review settings'}
          </button>
        </div>
      </div>
    </section>
  )

  // Embedded on the AI employee page → just the section, since that page already carries .v2.
  // Standalone → the same section under this route's own header.
  if (embedded) return content
  return (
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-3xl">
      <div className="v2-head">
        <Link href="/settings" className="v2-act tap-target"><ArrowLeft className="w-3.5 h-3.5" /> Settings</Link>
        <s />
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Reviews</p>
      </div>
      <p className="v2-hint" style={{ marginBottom: 22 }}>Automate Google review requests after appointments.</p>
      {content}
    </div>
  )
}
