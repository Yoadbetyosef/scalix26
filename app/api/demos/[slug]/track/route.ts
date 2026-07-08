import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logDemoEvent, updateDemoEngagement } from '@/lib/partner/demo'

// Public demo analytics beacon. event=view (on load) → records a view + unique visitor + advances
// the linked lead to 'demo_viewed'. event=dwell (on leave) → records time-on-demo. No auth.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await req.json().catch(() => ({}))
  const db = createAdminClient()
  const { data: demo } = await db.from('demos').select('id, partner_id, lead_id, prospect_name, view_count, unique_visitors, total_dwell_ms').eq('public_slug', slug).maybeSingle()
  if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.event === 'view') {
    const visitorId = typeof body.visitorId === 'string' && /^[0-9a-f-]{10,}$/i.test(body.visitorId) ? body.visitorId : null
    // Unique visitor?
    let isUnique = true
    if (visitorId) {
      const { data: seen } = await db.from('demo_views').select('id').eq('demo_id', demo.id).eq('visitor_id', visitorId).limit(1).maybeSingle()
      isUnique = !seen
    }
    const { data: view } = await db.from('demo_views').insert({ demo_id: demo.id, partner_id: demo.partner_id, visitor_id: visitorId, dwell_ms: 0 }).select('id').single()
    await db.from('demos').update({
      view_count: (demo.view_count || 0) + 1,
      unique_visitors: (demo.unique_visitors || 0) + (isUnique ? 1 : 0),
      last_viewed_at: new Date().toISOString(),
    }).eq('id', demo.id)

    // First-ever view: notify partner + advance linked lead.
    if ((demo.view_count || 0) === 0) {
      await db.from('partner_notifications').insert({ partner_id: demo.partner_id, kind: 'demo_viewed', title: 'Your demo was viewed', body: `${demo.prospect_name} just opened their demo.`, link: '/partner/demos' })
    }
    if (demo.lead_id) await db.from('crm_leads').update({ stage: 'demo_viewed', updated_at: new Date().toISOString() }).eq('id', demo.lead_id).eq('stage', 'demo_generated')
    await logDemoEvent(db, demo.id, demo.partner_id, 'view', visitorId)
    return NextResponse.json({ ok: true, viewId: view?.id })
  }

  if (body.event === 'dwell' && body.viewId && typeof body.ms === 'number') {
    const ms = Math.max(0, Math.min(body.ms, 1000 * 60 * 30)) // cap 30 min
    await db.from('demo_views').update({ dwell_ms: ms }).eq('id', body.viewId).eq('demo_id', demo.id)
    await db.from('demos').update({ total_dwell_ms: (demo.total_dwell_ms || 0) + ms }).eq('id', demo.id)
    await updateDemoEngagement(db, demo.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'bad event' }, { status: 400 })
}
