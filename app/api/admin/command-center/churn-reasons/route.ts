import { NextRequest, NextResponse } from 'next/server'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

// Founder-only manual churn-reason capture (Phase 3A — no customer-facing cancellation flow yet).
export const CHURN_REASONS = [
  'too_expensive', 'not_enough_value', 'setup_incomplete', 'too_complicated', 'ai_quality', 'call_quality',
  'integration_issue', 'missing_feature', 'business_closed', 'seasonal_pause', 'switched_competitor',
  'support_experience', 'billing_issue', 'no_usage', 'wrong_fit', 'unknown',
]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const { data } = await createAdminClient().from('cc_churn_reasons')
    .select('id, tenant_id, churned_at, mrr_cents, primary_reason, secondary_reasons, notes, save_attempted, save_outcome, reactivation_outcome, created_by, created_at')
    .order('created_at', { ascending: false }).limit(50)
  return NextResponse.json({ reasons: CHURN_REASONS, items: data ?? [] })
}

export async function POST(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood

  let b: { tenantId?: string; primaryReason?: string; secondaryReasons?: string[]; notes?: string; mrrCents?: number; churnedAt?: string; saveAttempted?: boolean; saveOutcome?: string; reactivationOutcome?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!b.tenantId || !UUID_RE.test(b.tenantId)) return NextResponse.json({ error: 'Valid tenantId required' }, { status: 400 })
  if (!b.primaryReason || !CHURN_REASONS.includes(b.primaryReason)) return NextResponse.json({ error: 'Valid primaryReason required' }, { status: 400 })

  const { data, error } = await createAdminClient().from('cc_churn_reasons').insert({
    tenant_id: b.tenantId, primary_reason: b.primaryReason,
    secondary_reasons: Array.isArray(b.secondaryReasons) ? b.secondaryReasons.filter((r) => CHURN_REASONS.includes(r)) : [],
    notes: b.notes ?? null, mrr_cents: Number.isFinite(b.mrrCents) ? b.mrrCents : null, churned_at: b.churnedAt ?? null,
    save_attempted: !!b.saveAttempted, save_outcome: b.saveOutcome ?? null, reactivation_outcome: b.reactivationOutcome ?? null, created_by: f.email,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(f.email, { action: 'cc_churn_reason', targetType: 'tenant', targetId: b.tenantId, after: { primary: b.primaryReason, saveAttempted: !!b.saveAttempted } })
  return NextResponse.json({ ok: true, id: data.id })
}
