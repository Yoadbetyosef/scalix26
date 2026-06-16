import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'

export async function GET(req: NextRequest) {
  if (!await isAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = await createServiceClient()
  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') || ''
  const plan = searchParams.get('plan') || ''
  const status = searchParams.get('status') || ''

  let query = supabase
    .from('tenants')
    .select(`
      id, user_id, business_name, email, phone, plan, created_at, trial_ends_at,
      stripe_customer_id, stripe_subscription_id
    `)
    .order('created_at', { ascending: false })

  if (plan) query = query.eq('plan', plan)
  if (search) query = query.or(`business_name.ilike.%${search}%,email.ilike.%${search}%`)

  const { data: tenants, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch auth users for emails
  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const authMap = Object.fromEntries(authUsers.map(u => [u.id, u]))

  const result = tenants?.map(t => ({
    ...t,
    auth_email: authMap[t.user_id]?.email || t.email,
    last_sign_in: authMap[t.user_id]?.last_sign_in_at,
    subscription_status: t.plan === 'trial' ? 'trialing' : 'active',
  })) || []

  // Stats
  const total = result.length
  const trials = result.filter(u => u.plan === 'trial').length
  const paid = result.filter(u => u.plan !== 'trial').length
  const mrr = result.filter(u => u.plan !== 'trial').reduce((acc, u) => {
    const amounts: Record<string, number> = { starter: 297, pro: 397, business: 597 }
    return acc + (amounts[u.plan] || 0)
  }, 0)

  return NextResponse.json({ users: result, stats: { total, trials, paid, mrr } })
}
