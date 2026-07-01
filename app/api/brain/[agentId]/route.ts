import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'

// Read the Business Brain for one AI employee: DNA, understandings, recommendations,
// pattern summary. Read-only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, tenantId } = ctx

  try {
    const [dnaRes, uRes, rRes, pRes] = await Promise.all([
      admin.from('business_dna').select('dna_strand, strength, evidence_count, last_updated_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
      admin.from('business_understanding').select('id, dna_strand, understanding_key, title, statement, business_confidence, evidence_strength, evidence_summary, last_seen_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).order('business_confidence', { ascending: false }),
      admin.from('business_recommendations').select('id, understanding_id, category, title, why, how, if_ignored, estimated_impact, business_confidence, evidence_strength, status').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).neq('status', 'dismissed').order('business_confidence', { ascending: false }),
      admin.from('business_patterns').select('category, pattern_key, title, description, metric_value, metric_unit, evidence_count').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
    ])

    const patterns = pRes.data || []
    const byCategory: Record<string, number> = {}
    for (const p of patterns) byCategory[p.category as string] = (byCategory[p.category as string] || 0) + 1
    const understandings = uRes.data || []

    return NextResponse.json({
      dna: dnaRes.data || [],
      understandings,
      recommendations: rRes.data || [],
      patternsSummary: { total: patterns.length, byCategory },
      learnedCount: understandings.length + patterns.length,
    })
  } catch (e) {
    // Table not migrated yet → empty Brain (no crash).
    return NextResponse.json({ dna: [], understandings: [], recommendations: [], patternsSummary: { total: 0, byCategory: {} }, learnedCount: 0, note: e instanceof Error ? e.message : 'not migrated' })
  }
}
