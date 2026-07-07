import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Public demo data for the branded preview page. Increments the view counter and notifies the
// owning partner on the FIRST view. No auth.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: demo } = await db.from('demos')
    .select('id, partner_id, prospect_name, industry, website, phone, branding, briefing, view_count')
    .eq('public_slug', slug).maybeSingle()
  if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Best-effort view tracking + first-view notification.
  db.from('demos').update({ view_count: (demo.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', demo.id).then(() => {})
  if ((demo.view_count || 0) === 0) {
    db.from('partner_notifications').insert({
      partner_id: demo.partner_id, kind: 'demo_viewed', title: 'Your demo was viewed 👀',
      body: `The demo for ${demo.prospect_name} was just opened.`, link: '/partner/demos',
    }).then(() => {})
  }

  const branding = (demo.branding || {}) as Record<string, string>
  const briefing = (demo.briefing || {}) as Record<string, string>
  return NextResponse.json({
    prospectName: demo.prospect_name, industry: demo.industry, website: demo.website, phone: demo.phone,
    branding: { logoUrl: branding.logoUrl, color: branding.color },
    greeting: briefing.greeting || `Hi! How can I help you today?`,
  })
}
