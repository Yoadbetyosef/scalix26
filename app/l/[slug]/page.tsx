import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'

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

  db.from('landing_pages').update({ view_count: (page.view_count || 0) + 1 }).eq('id', page.id).then(() => {})
  const code = (page.referral_links as unknown as { code?: string } | null)?.code
  const cfg = (page.config || {}) as { accent?: string }
  const accent = cfg.accent || '#5B6CF0'
  const ctaHref = code ? `/r/${code}` : '/auth/signup'

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{page.headline}</h1>
        {page.subhead && <p className="mt-4 max-w-xl text-lg text-subtle">{page.subhead}</p>}
        <a href={ctaHref} className="mt-8 inline-flex h-12 items-center justify-center rounded-xl px-8 text-base font-semibold text-white shadow-e2 transition-transform active:scale-[0.98]" style={{ background: accent }}>
          {page.cta_text || 'Get started free'}
        </a>
        <p className="mt-10 text-xs text-muted">Powered by Scalix26</p>
      </div>
    </div>
  )
}
