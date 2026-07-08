import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { DemoChat } from '@/components/partner/demo-chat'
import { DemoTracker } from '@/components/partner/demo-tracker'

export const dynamic = 'force-dynamic'

// Public, branded, interactive preview of a Scalix26 AI employee for a specific prospect.
export default async function PublicDemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: demo } = await db.from('demos')
    .select('prospect_name, industry, website, phone, branding, briefing, view_count, id')
    .eq('public_slug', slug).maybeSingle()
  if (!demo) notFound()

  // View + dwell tracking is handled client-side by <DemoTracker/> (unique visitors + time).
  const branding = (demo.branding || {}) as { logoUrl?: string; color?: string }
  const briefing = (demo.briefing || {}) as { greeting?: string }
  const accent = branding.color || '#5B6CF0'

  return (
    <div className="min-h-screen bg-canvas">
      <DemoTracker slug={slug} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <div className="mb-8 text-center">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={demo.prospect_name} className="mx-auto mb-4 h-16 w-16 rounded-2xl object-contain" />
          ) : (
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white" style={{ background: accent }}>
              {demo.prospect_name.charAt(0)}
            </div>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{demo.prospect_name}</h1>
          <p className="mt-1 text-sm text-subtle">Meet your AI employee — available 24/7 to answer calls, texts, and questions.</p>
        </div>

        <DemoChat slug={slug} greeting={briefing.greeting || `Hi! Thanks for contacting ${demo.prospect_name}. How can I help you today?`} accent={accent} />

        <div className="mt-6 rounded-2xl border border-hairline bg-surface p-5 text-center shadow-e1">
          <div className="font-semibold text-ink">Want this AI employee for {demo.prospect_name}?</div>
          <p className="mt-1 text-sm text-subtle">Answer every call &amp; text 24/7 and never miss a job.</p>
          <a href={`/demo/${slug}/start`} className="mt-3 inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-medium text-white" style={{ background: accent }}>
            Get started free
          </a>
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          Powered by <span className="font-medium text-subtle">Scalix26</span> · This is a live AI demo
        </p>
      </div>
    </div>
  )
}
