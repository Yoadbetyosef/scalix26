import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { planPrice, PLAN_PRICE } from '@/lib/admin/pricing'
import { RATE_DEEPGRAM_VOICE_PER_MIN, RATE_TWILIO_VOICE_PER_MIN, RATE_TWILIO_SMS_PER_SEGMENT, RATE_VOICE_LLM_PER_MIN } from '@/lib/cost/rates'

// Per voice minute = Deepgram Voice Agent + Twilio telephony + an estimated Anthropic BYO LLM
// component (Deepgram bills by time and doesn't report LLM tokens; see rates.ts).
const VOICE_PER_MIN = RATE_DEEPGRAM_VOICE_PER_MIN + RATE_TWILIO_VOICE_PER_MIN + RATE_VOICE_LLM_PER_MIN

// GET /api/admin/cost — COGS: cost per customer + platform run-rate + gross margin (this month).
// LLM cost is exact (usage_events, logged per call). Voice/SMS are real usage × configured
// unit rates. Learning cost is the measured actual_cost from learning_jobs.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createAdminClient()
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const iso = monthStart.toISOString()
  const now = new Date()
  const daysElapsed = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  const [tenantsRes, llmRes, convRes, smsRes, learnRes] = await Promise.all([
    db.from('tenants').select('id, business_name, plan'),
    db.from('usage_events').select('tenant_id, cost_usd').eq('kind', 'llm').gte('created_at', iso).limit(100000),
    // Voice minutes live on analytics_events (channel='voice', data.duration_seconds) — set by
    // /api/analytics/call. conversations.duration_seconds is not populated.
    db.from('analytics_events').select('tenant_id, data').eq('event_type', 'message_handled').gte('created_at', iso).limit(200000),
    db.from('messages').select('tenant_id').eq('channel', 'sms').gte('timestamp', iso).limit(200000),
    // learning_jobs may not exist / lack created_at → resolves with {error}, handled as empty.
    db.from('learning_jobs').select('tenant_id, actual_cost').gte('created_at', iso).limit(100000),
  ])

  type Bucket = { llm: number; voiceMin: number; sms: number; learning: number }
  const perTenant = new Map<string, Bucket>()
  const b = (id: string) => { let x = perTenant.get(id); if (!x) { x = { llm: 0, voiceMin: 0, sms: 0, learning: 0 }; perTenant.set(id, x) } return x }

  for (const r of llmRes.data || []) if (r.tenant_id) b(r.tenant_id).llm += Number(r.cost_usd) || 0
  for (const r of convRes.data || []) {
    const dv = r.data as { channel?: string; duration_seconds?: number } | null
    if (r.tenant_id && dv?.channel === 'voice' && typeof dv.duration_seconds === 'number') b(r.tenant_id).voiceMin += dv.duration_seconds / 60
  }
  for (const r of smsRes.data || []) if (r.tenant_id) b(r.tenant_id).sms += 1
  const learnRows = (learnRes.data || []) as { tenant_id: string; actual_cost: number }[]
  for (const r of learnRows) if (r.tenant_id) b(r.tenant_id).learning += Number(r.actual_cost) || 0

  const costOf = (x: Bucket) => x.llm + x.voiceMin * VOICE_PER_MIN + x.sms * RATE_TWILIO_SMS_PER_SEGMENT + x.learning

  const tenants = tenantsRes.data || []
  const customers = tenants.map((t) => {
    const x = perTenant.get(t.id) || { llm: 0, voiceMin: 0, sms: 0, learning: 0 }
    const cost = costOf(x)
    const revenue = planPrice(t.plan)
    return {
      id: t.id, name: t.business_name, plan: t.plan, revenue,
      cost: Math.round(cost * 100) / 100,
      llm: Math.round(x.llm * 100) / 100,
      voice: Math.round(x.voiceMin * VOICE_PER_MIN * 100) / 100,
      sms: Math.round(x.sms * RATE_TWILIO_SMS_PER_SEGMENT * 100) / 100,
      learning: Math.round(x.learning * 100) / 100,
      margin: Math.round((revenue - cost) * 100) / 100,
    }
  }).sort((a, b2) => b2.cost - a.cost)

  const totals = {
    llm: 0, voice: 0, sms: 0, learning: 0, total: 0,
  }
  for (const x of perTenant.values()) {
    totals.llm += x.llm; totals.voice += x.voiceMin * VOICE_PER_MIN
    totals.sms += x.sms * RATE_TWILIO_SMS_PER_SEGMENT; totals.learning += x.learning
  }
  totals.total = totals.llm + totals.voice + totals.sms + totals.learning
  const round = (n: number) => Math.round(n * 100) / 100
  Object.keys(totals).forEach((k) => { (totals as Record<string, number>)[k] = round((totals as Record<string, number>)[k]) })

  const dailyAvg = daysElapsed > 0 ? totals.total / daysElapsed : 0
  const projectedMonth = dailyAvg * daysInMonth

  // Plan MRR
  const counts = tenants.reduce((m, t) => { if (t.plan && t.plan !== 'trial') m[t.plan] = (m[t.plan] || 0) + 1; return m }, {} as Record<string, number>)
  const mrr = Object.entries(counts).reduce((s, [p, c]) => s + (PLAN_PRICE[p] || 0) * c, 0)
  const projectedCost = projectedMonth
  const grossMargin = mrr - projectedCost

  return NextResponse.json({
    period: { monthStart: iso, daysElapsed, daysInMonth },
    totals,
    runRate: { mtd: totals.total, dailyAvg: round(dailyAvg), projectedMonth: round(projectedMonth) },
    margin: { mrr, projectedCost: round(projectedCost), grossMargin: round(grossMargin), grossMarginPct: mrr > 0 ? Math.round((grossMargin / mrr) * 100) : null },
    customers,
    rates: {
      voicePerMin: VOICE_PER_MIN,
      smsPerSegment: RATE_TWILIO_SMS_PER_SEGMENT,
      note: 'Text LLM cost is exact (logged tokens). Voice = Deepgram + Twilio (from real minutes) + an ESTIMATED Anthropic BYO LLM component (Deepgram doesn’t report voice tokens). SMS = real segments × rate.',
    },
  })
}
