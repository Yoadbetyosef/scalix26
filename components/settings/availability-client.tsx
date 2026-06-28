'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Star } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

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
  const supabase = createClient()

  const [reviewUrl, setReviewUrl] = useState(googleReviewUrl)
  const [autoReview, setAutoReview] = useState(reviewEnabled)
  const [savingReview, setSavingReview] = useState(false)

  async function saveReviews() {
    setSavingReview(true)
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ google_review_url: reviewUrl.trim() || null, review_automation_enabled: autoReview })
        .eq('id', tenantId)
      if (error) throw error
      toast.success('Review settings saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingReview(false)
    }
  }

  const content = (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2.5"><span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-yellow-500 text-white shadow-e1"><Star className="h-[18px] w-[18px]" strokeWidth={2} /></span> Google Reviews</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Google review link</Label>
          <Input className="mt-1.5" placeholder="https://g.page/r/..." value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={autoReview} onChange={(e) => setAutoReview(e.target.checked)} className="accent-[#5B6CF0] w-4 h-4" />
          Auto-send a review request 3 hours after each appointment
        </label>
        <Button onClick={saveReviews} loading={savingReview} className="w-full sm:w-auto">Save Review Settings</Button>
      </CardContent>
    </Card>
  )

  // Embedded on the AI employee page → just the card. Standalone → full page chrome.
  if (embedded) return <div className="space-y-5">{content}</div>
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-muted hover:text-ink transition-colors"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Reviews</h1>
          <p className="text-sm text-muted mt-1">Automate Google review requests after appointments.</p>
        </div>
      </div>
      {content}
    </div>
  )
}
