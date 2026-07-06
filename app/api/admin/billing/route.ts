import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { PLAN_PRICE } from '@/lib/admin/pricing'

async function stripeGet(path: string, key: string): Promise<{ data?: unknown[] } | null> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal })
    if (!res.ok) return null
    return (await res.json()) as { data?: unknown[] }
  } catch {
    return null
  } finally {
    clearTimeout(to)
  }
}

// Monthly-equivalent amount (USD) of a Stripe subscription's items.
function subMrr(sub: unknown): number {
  const items = (sub as { items?: { data?: unknown[] } }).items?.data || []
  let cents = 0
  for (const it of items) {
    const price = (it as { price?: { unit_amount?: number; recurring?: { interval?: string } }; quantity?: number }).price
    const qty = (it as { quantity?: number }).quantity || 1
    const amt = (price?.unit_amount || 0) * qty
    cents += price?.recurring?.interval === 'year' ? amt / 12 : price?.recurring?.interval === 'week' ? amt * 4.33 : amt
  }
  return cents / 100
}

// GET /api/admin/billing — plan-based MRR/ARR (always real) + live Stripe where configured.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createAdminClient()
  const q = (plan: string) => db.from('tenants').select('*', { count: 'exact', head: true }).eq('plan', plan)
  const [starter, pro, business, trial] = await Promise.all([q('starter'), q('pro'), q('business'), q('trial')])
  const planMrr =
    (starter.count || 0) * PLAN_PRICE.starter + (pro.count || 0) * PLAN_PRICE.pro + (business.count || 0) * PLAN_PRICE.business
  const payingCustomers = (starter.count || 0) + (pro.count || 0) + (business.count || 0)

  let stripe: null | { mrr: number; activeSubscriptions: number; pastDue: number; openInvoices: number } = null
  if (process.env.STRIPE_SECRET_KEY) {
    const key = process.env.STRIPE_SECRET_KEY
    const [active, past, open] = await Promise.all([
      stripeGet('subscriptions?status=active&limit=100', key),
      stripeGet('subscriptions?status=past_due&limit=100', key),
      stripeGet('invoices?status=open&limit=100', key),
    ])
    if (active || past || open) {
      const activeSubs = active?.data || []
      stripe = {
        mrr: Math.round(activeSubs.reduce<number>((s, sub) => s + subMrr(sub), 0)),
        activeSubscriptions: activeSubs.length,
        pastDue: (past?.data || []).length,
        openInvoices: (open?.data || []).length,
      }
    }
  }

  return NextResponse.json({
    plan: { mrr: planMrr, arr: planMrr * 12, payingCustomers, trials: trial.count || 0 },
    stripe, // null when unreachable / not configured
    clv: null, // Not tracked yet (needs historical revenue analysis)
  })
}
