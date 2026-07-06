import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { planPrice } from '@/lib/admin/pricing'

// GET /api/admin/businesses — server-side paginated / searchable / filterable list.
// Scalable: pages the DB (range), never loads all rows into the client. Agent + channel
// counts come embedded from Postgres in the same query.
export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const page = Math.max(0, parseInt(sp.get('page') || '0', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '25', 10)))
  const search = (sp.get('search') || '').trim()
  const status = sp.get('status') || '' // active | trial | suspended | enterprise

  const db = createAdminClient() // service-role: bypass RLS to list all businesses
  let query = db
    .from('tenants')
    .select('id, user_id, business_name, email, phone, industry, plan, created_at, suspended_at, tags, ai_employees(count), channels(count)', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (search) {
    const s = search.replace(/[%,]/g, '')
    query = query.or(`business_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,industry.ilike.%${s}%`)
  }
  if (status === 'trial') query = query.eq('plan', 'trial')
  else if (status === 'suspended') query = query.not('suspended_at', 'is', null)
  else if (status === 'active') query = query.neq('plan', 'trial').is('suspended_at', null)
  else if (status === 'enterprise') query = query.contains('tags', ['Enterprise'])

  const { data, count, error } = await query.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Owner email + last login from auth (mapped once). NOTE: listUsers pages at 1000 — fine at
  // current scale; a future phase can denormalize last_login onto the tenant for true scale.
  const { data: authData } = await db.auth.admin.listUsers({ perPage: 1000 })
  const byId = Object.fromEntries((authData?.users || []).map((u) => [u.id, u]))

  const embeddedCount = (v: unknown): number => (Array.isArray(v) && v[0] && typeof v[0].count === 'number' ? v[0].count : 0)

  const businesses = (data || []).map((t) => {
    const au = byId[t.user_id]
    const suspended = !!t.suspended_at
    return {
      id: t.id,
      business_name: t.business_name,
      owner_email: au?.email || t.email || null,
      owner_name: (au?.user_metadata?.name as string) || (au?.user_metadata?.full_name as string) || null,
      phone: t.phone,
      industry: t.industry,
      plan: t.plan,
      status: suspended ? 'suspended' : t.plan === 'trial' ? 'trial' : 'active',
      suspended,
      created_at: t.created_at,
      last_login: au?.last_sign_in_at || null,
      agents: embeddedCount((t as unknown as { ai_employees?: unknown }).ai_employees),
      channels: embeddedCount((t as unknown as { channels?: unknown }).channels),
      revenue: planPrice(t.plan),
      tags: t.tags || [],
    }
  })

  return NextResponse.json({ businesses, total: count ?? 0, page, pageSize })
}
