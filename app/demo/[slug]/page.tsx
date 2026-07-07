import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { DemoChat } from '@/components/partner/demo-chat'

export const dynamic = 'force-dynamic'

// Public, branded, interactive preview of a Scalix26 AI employee for a specific prospect.
export default async function PublicDemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: demo } = await db.from('demos')
    .select('prospect_name, industry, website, phone, branding, briefing, view_count, id')
    .eq('public_slug', slug).maybeSingle()
  if (!demo) notFound()

  // Fire a view increment (best-effort).
  db.from('demos').update({ view_count: (demo.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', demo.id).then(() => {})

  const branding = (demo.branding || {}) as { logoUrl?: string; color?: string }
  const briefing = (demo.briefing || {}) as { greeting?: string }
  const accent = branding.color || '#5B6CF0'

  return (
    <div className="min-h-screen bg-canvas">
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

        <p className="mt-8 text-center text-xs text-muted">
          Powered by <span className="font-medium text-subtle">Scalix26</span> · This is a live AI demo
        </p>
      </div>
    </div>
  )
}
