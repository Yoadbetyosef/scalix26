import type { BusinessSignal, BehaviorHypothesis, ConfidenceTier, SignalType } from './types'
import { PLAYBOOK_SECTIONS } from '@/lib/playbook/types'
import { callModel, extractJsonArray } from './llm'
import type { LearningBudget } from './budget'

const SECTION_KEYS = PLAYBOOK_SECTIONS.map((s) => s.key as string)

// ── Focused distillation passes ──────────────────────────────────────────────────
// One generic pass was too conservative. Instead we run a dedicated pass per behavior
// facet, each with its own evidence bar. GOLD facets — where the OWNER acted directly
// (manual replies, corrections, takeovers) — get the lowest bar and the highest weight,
// because the owner's own behavior is the strongest possible evidence.
interface Facet {
  key: string
  label: string
  dimension: string // default playbook section
  signalTypes: SignalType[]
  gold: boolean
  minEvidence: number
}

const FACETS: Facet[] = [
  { key: 'owner_correction', label: 'owner corrections & manual replies (the owner’s own words)', dimension: 'examples', signalTypes: ['owner_message', 'correction_delta'], gold: true, minEvidence: 1 },
  { key: 'escalation', label: 'escalation & takeover behavior', dimension: 'escalation_rules', signalTypes: ['escalation_moment'], gold: true, minEvidence: 1 },
  { key: 'pricing', label: 'pricing behavior', dimension: 'pricing_rules', signalTypes: ['pricing_response'], gold: false, minEvidence: 2 },
  { key: 'booking', label: 'booking behavior', dimension: 'booking_rules', signalTypes: ['booking_decision'], gold: false, minEvidence: 2 },
  { key: 'refusal', label: 'which jobs/customers the business refuses', dimension: 'qualification_rules', signalTypes: ['refusal'], gold: false, minEvidence: 1 },
  { key: 'objection', label: 'objection handling', dimension: 'objection_handling', signalTypes: ['objection_handling'], gold: false, minEvidence: 2 },
  { key: 'complaint', label: 'complaint & upset-customer handling', dimension: 'do_say', signalTypes: ['complaint'], gold: false, minEvidence: 2 },
  { key: 'phrases_tone', label: 'repeated phrases & tone of voice', dimension: 'tone_profile', signalTypes: ['phrase_usage', 'owner_message'], gold: false, minEvidence: 2 },
  { key: 'follow_up', label: 'follow-up behavior', dimension: 'follow_up_rules', signalTypes: ['booking_decision', 'outcome'], gold: false, minEvidence: 3 },
]

function tierOf(confidence: number, evidence: number, gold: boolean): ConfidenceTier {
  let score = confidence
  if (gold) score = Math.max(score, 0.5) // owner's own action is never "no evidence"
  if (score >= 0.75 && evidence >= 3) return 'high'
  if (score >= 0.6 && evidence >= 2) return 'medium'
  if (score >= 0.4 || gold) return 'low'
  return 'observed'
}

// Statements are stored as bare verb phrases (e.g. "answer pricing with a range") so the
// safe-phrasing tiers below read naturally at any confidence level.
function phraseFor(tier: ConfidenceTier, statement: string): string {
  const s = statement.replace(/\.$/, '')
  if (tier === 'high') return `This appears to be a consistent pattern — you ${s}.`
  if (tier === 'medium') return `I noticed you usually ${s}.`
  return `I noticed this may be happening — you sometimes ${s}.` // low / observed: tentative
}

function facetSummary(facet: Facet, signals: BusinessSignal[]): string {
  const lines = signals.slice(0, 18).map((s) => {
    const style = s.payload?.style ? ` [style:${s.payload.style}]` : ''
    return `  - ${s.evidence}${style}`
  })
  let extra = ''
  if (facet.key === 'pricing') {
    const styles: Record<string, number> = {}
    for (const s of signals) { const st = String(s.payload?.style || 'unknown'); styles[st] = (styles[st] || 0) + 1 }
    extra = `\npricing_style_distribution: ${JSON.stringify(styles)}`
  }
  return `${lines.join('\n')}${extra}`
}

async function distillFacet(facet: Facet, signals: BusinessSignal[], budget?: LearningBudget): Promise<BehaviorHypothesis[]> {
  const present = signals.filter((s) => facet.signalTypes.includes(s.type))
  if (present.length < facet.minEvidence) return []

  const channels = [...new Set(present.map((s) => s.channel).filter(Boolean))] as string[]
  const evidenceCount = present.length
  const goldNote = facet.gold
    ? `These signals are the OWNER'S OWN actions/words — the STRONGEST evidence. Even 1–2 examples justify a low- or medium-confidence pattern. Do not dismiss them.`
    : `Short, repeated patterns count. If the same behavior recurs even briefly, propose a LOW-confidence pattern rather than nothing.`

  const allowed = facet.gold ? ['examples', 'do_say', 'tone_profile', 'escalation_rules', facet.dimension] : [facet.dimension]
  const prompt = `Focused analysis of ONE behavior facet for a local business: ${facet.label}.
${goldNote}
You are not summarizing — you are extracting concrete behavior patterns with a confidence level. It is OK and expected to output LOW-confidence patterns; do not require long transcripts.

Return ONLY a JSON array (0–3 items). Each item:
{
  "statement": "the behavior as a short VERB PHRASE in second person, starting with a verb (e.g. 'answer pricing with a range', 'take over when the customer is upset', 'confirm the address before booking'). No leading 'You' or 'The business'.",
  "dimension": one of ${JSON.stringify([...new Set(allowed)])},
  "confidence": 0.0-1.0,
  "consistency": 0.0-1.0,
  "examples": [{"customer":"...","reply":"..."}] or [{"note":"..."}],
  "outcome_note": "optional",
  "proposed": {"text":"the rule to add"}   // for the 'examples' dimension use {"customer":"...","reply":"..."}
}
Return [] only if the signals truly show no pattern.

SIGNALS (${evidenceCount}) for "${facet.key}":
${facetSummary(facet, present)}`

  // Final hypotheses the owner will see → STRONG model tier, gated by the shared budget.
  const raw = await callModel(prompt, 900, { budget, tier: 'strong' })
  const items = extractJsonArray(raw)

  return items
    .filter((h) => h && h.statement)
    .slice(0, 3)
    .map((h): BehaviorHypothesis => {
      const confidence = Math.max(0, Math.min(1, Number(h.confidence) || (facet.gold ? 0.5 : 0.4)))
      const consistency = Math.max(0, Math.min(1, Number(h.consistency) || 0.5))
      const tier = tierOf(confidence, evidenceCount, facet.gold)
      const statement = String(h.statement).slice(0, 300)
      const dimension = SECTION_KEYS.includes(h.dimension) ? h.dimension : facet.dimension
      return {
        dimension,
        facet: facet.key,
        statement,
        evidence_count: evidenceCount,
        consistency,
        confidence,
        tier,
        gold: facet.gold,
        source_signal_types: facet.signalTypes.filter((t) => present.some((s) => s.type === t)),
        channels,
        examples: Array.isArray(h.examples) ? h.examples.slice(0, 4) : [],
        outcome_note: h.outcome_note ? String(h.outcome_note).slice(0, 200) : undefined,
        proposed: h.proposed && typeof h.proposed === 'object' ? h.proposed : { text: statement },
        phrasing: phraseFor(tier, statement),
        show_to_owner: tier !== 'observed',
      }
    })
}

// Run facets SEQUENTIALLY (not in parallel) so the budget gate can enforce the per-run
// call cap and stop early once it's hit. FACETS are ordered gold-first, so the highest-
// value patterns (owner corrections, escalations) are learned before any budget runs out.
export async function distill(signals: BusinessSignal[], budget?: LearningBudget): Promise<BehaviorHypothesis[]> {
  if (!signals.length) return []
  const out: BehaviorHypothesis[] = []
  for (const f of FACETS) {
    if (budget?.paused) break // budget exhausted → stop safely, keep what we have
    try { out.push(...(await distillFacet(f, signals, budget))) } catch { /* skip this facet */ }
  }
  // Highest-confidence / gold first.
  return out.sort((a, b) => Number(b.gold) - Number(a.gold) || b.confidence - a.confidence)
}
