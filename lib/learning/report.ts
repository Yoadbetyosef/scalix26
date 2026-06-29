import type { LearningReport } from './types'

// Human-readable summary for review. Answers V1's five internal questions:
// what happened · why · which rule might explain it · how confident · should we suggest it.
export function formatReport(r: LearningReport): string {
  const L: string[] = []
  L.push(`════════ BUSINESS LEARNING ENGINE v1 — ${r.tenantName} ════════`)
  L.push(`Window: ${r.window.since?.slice(0, 10) || 'all'} → ${r.window.until.slice(0, 10)}   ·   ${r.persisted ? 'PERSISTED' : 'DRY RUN (no writes)'}`)
  L.push('')

  L.push('DATA SOURCES USED:')
  L.push(`  ${r.sources.length ? r.sources.join(', ') : '(none — no activity in window)'}`)
  L.push(`  conversations ${r.counts.conversations} · messages ${r.counts.messages} · leads ${r.counts.leads} · appointments ${r.counts.appointments}`)
  L.push('')

  L.push(`WHAT HAPPENED — ${r.counts.signals} business signals generated:`)
  const byType = Object.entries(r.counts.signalsByType).sort((a, b) => b[1] - a[1])
  for (const [t, n] of byType) L.push(`  • ${t}: ${n}`)
  if (!byType.length) L.push('  (no signals)')
  L.push('')

  L.push(`WHY / WHICH RULE MIGHT EXPLAIN IT — ${r.hypotheses.length} behavior patterns detected (the Owner Behavior Model forming):`)
  for (const h of r.hypotheses) {
    const mark = h.gold ? '★ GOLD' : `tier:${h.tier}`
    L.push(`  • [${h.facet} → ${h.dimension}] ${h.statement}`)
    L.push(`      ${mark} · confidence ${Math.round(h.confidence * 100)}% · evidence ${h.evidence_count} · consistency ${Math.round(h.consistency * 100)}%`)
    if (h.outcome_note) L.push(`      outcome: ${h.outcome_note}`)
  }
  if (!r.hypotheses.length) L.push('  (no patterns yet — needs more conversations)')
  L.push('')

  const golds = r.suggestions.filter((s) => s.gold).length
  L.push(`SUGGESTIONS THAT WOULD BE SHOWN TO THE OWNER — ${r.suggestions.length} (${golds} from gold signals):`)
  for (const s of r.suggestions) {
    const proposal = s.proposed.text || (s.proposed.customer ? `"${s.proposed.customer}" → "${s.proposed.reply}"` : s.statement)
    L.push(`  ▸ [${s.tier}${s.gold ? '/gold' : ''}] "${s.phrasing}"`)
    L.push(`      → propose to [${s.dimension}]: ${proposal}  (${Math.round(s.confidence * 100)}% sure, evidence ${s.evidence_count})`)
  }
  if (!r.suggestions.length) L.push('  (none cleared the evidence bar yet)')
  L.push('')

  if (r.notes.length) { L.push('NOTES:'); for (const n of r.notes) L.push(`  - ${n}`); L.push('') }

  L.push('STILL NEEDS FUTURE PHASES:')
  L.push('  - Runtime Decision Layer (context→action→outcome) — not wired; runtime still uses the approved Playbook only.')
  L.push('  - Outcome Learning loop (reward/credit from bookings vs losses) — outcomes captured as signals, not yet attributed.')
  L.push('  - Prediction (lead scoring, forecasts) — deferred to v3.')
  L.push('  - Embeddings / vector retrieval — deferred.')
  L.push('  - Owner approval still required for any behavior to go live (by design).')
  return L.join('\n')
}
