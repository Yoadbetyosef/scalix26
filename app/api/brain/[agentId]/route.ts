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
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const [dnaRes, uRes, rRes, pRes, updRes, convRes, weekRes] = await Promise.all([
      admin.from('business_dna').select('dna_strand, strength, evidence_count, last_updated_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
      admin.from('business_understanding').select('id, dna_strand, understanding_key, title, statement, business_confidence, evidence_strength, evidence_summary, last_seen_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).order('business_confidence', { ascending: false }),
      admin.from('business_recommendations').select('id, understanding_id, category, title, why, how, if_ignored, estimated_impact, business_confidence, evidence_strength, status').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).neq('status', 'dismissed').order('business_confidence', { ascending: false }),
      admin.from('business_patterns').select('category, pattern_key, title, description, metric_value, metric_unit, evidence_count').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
      admin.from('brain_updates').select('kind, dna_strand, title, detail, delta, created_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).order('created_at', { ascending: false }).limit(12),
      admin.from('conversations').select('channel').eq('tenant_id', tenantId).limit(5000),
      admin.from('brain_updates').select('dna_strand, delta').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).eq('kind', 'dna_up').gte('created_at', weekAgo),
    ])

    const patterns = pRes.data || []
    const byCategory: Record<string, number> = {}
    for (const p of patterns) byCategory[p.category as string] = (byCategory[p.category as string] || 0) + 1
    const understandings = uRes.data || []
    const dna = dnaRes.data || []

    // Real per-channel study counts (for the hero).
    const chCount: Record<string, number> = {}
    for (const c of convRes.data || []) chCount[(c.channel as string) || 'other'] = (chCount[(c.channel as string) || 'other'] || 0) + 1
    const sources = {
      total: (convRes.data || []).length,
      voice: chCount.voice || 0, sms: chCount.sms || 0, email: chCount.email || 0,
      facebook: chCount.facebook || 0, instagram: chCount.instagram || 0, whatsapp: chCount.whatsapp || 0,
    }

    // Weekly DNA momentum (from the change log).
    const dnaWeekDelta: Record<string, number> = {}
    for (const w of weekRes.data || []) dnaWeekDelta[w.dna_strand as string] = (dnaWeekDelta[w.dna_strand as string] || 0) + (Number(w.delta) || 0)

    const lastLearned = dna.map((d) => d.last_updated_at as string).sort().pop() || null

    return NextResponse.json({
      dna, understandings,
      recommendations: rRes.data || [],
      patterns,
      updates: updRes.data || [],
      sources, dnaWeekDelta, lastLearned,
      patternsSummary: { total: patterns.length, byCategory },
      learnedCount: understandings.length + patterns.length,
    })
  } catch (e) {
    // Table not migrated yet → empty Brain (no crash).
    return NextResponse.json({ dna: [], understandings: [], recommendations: [], patterns: [], updates: [], sources: { total: 0, voice: 0, sms: 0, email: 0, facebook: 0, instagram: 0, whatsapp: 0 }, dnaWeekDelta: {}, lastLearned: null, patternsSummary: { total: 0, byCategory: {} }, learnedCount: 0, note: e instanceof Error ? e.message : 'not migrated' })
  }
}
