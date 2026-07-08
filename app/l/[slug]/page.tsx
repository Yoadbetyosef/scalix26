import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { LandingRender } from '@/components/partner/landing-render'

export const dynamic = 'force-dynamic'

// Public partner landing page. Its CTA routes through the attached referral link so every click +
// signup attributes to this page's campaign + creative. No auth.
export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: page } = await db.from('landing_pages')
    .select('id, headline, subhead, cta_text, config, view_count, referral_links(code)')
    .eq('slug', slug).maybeSingle()
  if (!page) notFound()
  const cfg = (page.config || {}) as { accent?: string; status?: string; logoUrl?: string; imageUrl?: string; videoUrl?: string; features?: string[]; socialProof?: string }
  if (cfg.status === 'archived') notFound()

  db.from('landing_pages').update({ view_count: (page.view_count || 0) + 1 }).eq('id', page.id).then(() => {})
  const code = (page.referral_links as unknown as { code?: string } | null)?.code
  const ctaHref = code ? `/r/${code}` : '/auth/signup'

  return (
    <div className="min-h-screen bg-canvas">
      <LandingRender c={{
        headline: page.headline, subhead: page.subhead, ctaText: page.cta_text, ctaHref,
        accent: cfg.accent, logoUrl: cfg.logoUrl, imageUrl: cfg.imageUrl, videoUrl: cfg.videoUrl,
        features: cfg.features, socialProof: cfg.socialProof,
      }} />
    </div>
  )
}
