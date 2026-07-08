import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// A logged-in customer (tenant) leaves a review for a partner. Starts 'pending' (admin moderates).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in to leave a review.' }, { status: 401 })

  const { partnerSlug, rating, body } = await req.json().catch(() => ({}))
  const r = Number(rating)
  if (!partnerSlug || !(r >= 1 && r <= 5)) return NextResponse.json({ error: 'A rating (1–5) is required.' }, { status: 400 })

  const db = createAdminClient()
  const [{ data: partner }, { data: tenant }] = await Promise.all([
    db.from('partners').select('id').eq('slug', partnerSlug).maybeSingle(),
    db.from('tenants').select('id').eq('user_id', user.id).maybeSingle(),
  ])
  if (!partner) return NextResponse.json({ error: 'Partner not found.' }, { status: 404 })
  if (!tenant) return NextResponse.json({ error: 'Only customers can leave a review.' }, { status: 403 })

  // One review per (partner, tenant) — update if it exists.
  const { data: existing } = await db.from('marketplace_reviews').select('id').eq('partner_id', partner.id).eq('author_tenant_id', tenant.id).maybeSingle()
  if (existing) {
    await db.from('marketplace_reviews').update({ rating: r, body: body || null, status: 'pending' }).eq('id', existing.id)
  } else {
    await db.from('marketplace_reviews').insert({ partner_id: partner.id, author_tenant_id: tenant.id, rating: r, body: body || null, status: 'pending' })
  }
  await db.from('partner_notifications').insert({ partner_id: partner.id, kind: 'new_review', title: 'New review submitted', body: `A customer left a ${r}★ review (pending approval).`, link: '/partner/marketplace' })
  return NextResponse.json({ success: true })
}
