import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { loadBrainView } from '@/lib/brain/view'

// Read the Business Brain for one AI employee: DNA, understandings, recommendations,
// pattern summary. Read-only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, tenantId } = ctx

  try {
    const view = await loadBrainView(admin, tenantId, agentId)
    const byCategory: Record<string, number> = {}
    for (const p of view.patterns) byCategory[p.category as string] = (byCategory[p.category as string] || 0) + 1
    return NextResponse.json({ ...view, patternsSummary: { total: view.patterns.length, byCategory } })
  } catch (e) {
    // Table not migrated yet → empty Brain (no crash).
    return NextResponse.json({ dna: [], understandings: [], recommendations: [], patterns: [], updates: [], sources: { total: 0, voice: 0, sms: 0, email: 0, facebook: 0, instagram: 0, whatsapp: 0 }, dnaWeekDelta: {}, lastLearned: null, financialVisibility: { percent: 0, connected: [], missing: [], note: '' }, patternsSummary: { total: 0, byCategory: {} }, learnedCount: 0, note: e instanceof Error ? e.message : 'not migrated' })
  }
}
