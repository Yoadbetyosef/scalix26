import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { PLAN_PRICE } from '@/lib/admin/pricing'

// GET /api/admin/overview — real KPIs for the admin dashboard. Every number is a live count;
// metrics we don't yet have a data source for return null and render as "Not tracked yet".
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = await createServiceClient()
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const todayISO = startOfToday.toISOString()

  const q = (table: string) => db.from(table).select('*', { count: 'exact', head: true })

  const res = await Promise.all([
    q('tenants'),
    q('tenants').eq('plan', 'trial'),
    q('tenants').not('suspended_at', 'is', null),
    q('tenants').eq('plan', 'starter'),
    q('tenants').eq('plan', 'pro'),
    q('tenants').eq('plan', 'business'),
    q('tenants').neq('plan', 'trial').is('suspended_at', null),
    q('conversations').eq('channel', 'voice').gte('created_at', todayISO),
    q('messages').gte('timestamp', todayISO),
    q('leads').gte('created_at', todayISO),
    q('appointments').gte('created_at', todayISO),
    q('ai_employees').eq('status', 'active'),
  ])
  const n = (i: number): number | null => (res[i].error ? null : (res[i].count ?? 0))

  const starter = n(3) || 0, pro = n(4) || 0, business = n(5) || 0
  const mrr = starter * PLAN_PRICE.starter + pro * PLAN_PRICE.pro + business * PLAN_PRICE.business

  return NextResponse.json({
    kpis: {
      totalBusinesses: n(0),
      activeBusinesses: n(6),
      trialBusinesses: n(1),
      suspendedBusinesses: n(2),
      churnedBusinesses: null, // Not tracked yet (needs subscription lifecycle / Stripe)
      mrr,
      arr: mrr * 12,
      callsToday: n(7),
      messagesToday: n(8),
      leadsToday: n(9),
      appointmentsToday: n(10),
      activeAgents: n(11),
      systemHealth: n(0) !== null ? 'operational' : 'degraded',
    },
  })
}
