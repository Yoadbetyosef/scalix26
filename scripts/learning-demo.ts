// Standalone demonstration of Cumulative Business Memory (C) + LearningPolicy Planner (B).
// Pure logic only — no database, no LLM, no network. Run:
//   npx tsc -p tsconfig.demo.json && node .demo-build/scripts/learning-demo.js
import { planLearningJob } from '../lib/learning/planner'
import { partitionPatterns, reinforceConfidence, jaccard, type MemoryEntry } from '../lib/learning/memory'
import type { Representative } from '../lib/learning/select'

const now = new Date().toISOString()

function rep(patternHash: string, facet: string, tokens: string[], frequency: number, question: string): Representative {
  return {
    id: 'c_' + patternHash, channel: 'sms', human_takeover: false, sentiment: null,
    messages: [{ role: 'user', content: question }],
    frequency, patternKey: `sms|${facet}|${tokens.join(' ')}`, patternHash, tokens, facet,
  }
}
function entry(patternHash: string, facet: string, tokens: string[], confidence: number, evidence: number, statement: string): MemoryEntry {
  return {
    id: 'e_' + patternHash, tenant_id: 't1', ai_employee_id: 'a1', facet, dimension: facet,
    pattern_hash: patternHash, pattern_key: `sms|${facet}|${tokens.join(' ')}`, tokens,
    statement, channels: ['sms'], evidence_count: evidence, confidence,
    first_seen_at: now, last_seen_at: now, last_evidence: {}, suggestion_id: null, status: 'active',
  }
}
const usd = (n: number) => '$' + n.toFixed(6)
const line = () => console.log('─'.repeat(74))

// ── Existing Business Memory ─────────────────────────────────────────────────────
const memory: MemoryEntry[] = [
  entry('h_lockout', 'pricing', ['how', 'much', 'lockout', 'cost'], 0.50, 3, 'answer lockout pricing with a range'),
  entry('h_hours', 'hours_location', ['what', 'are', 'your', 'hours'], 0.60, 5, 'state business hours directly'),
]

// ── Incoming patterns this run ───────────────────────────────────────────────────
const R1 = rep('h_lockout', 'pricing', ['how', 'much', 'lockout', 'cost'], 12, 'how much does a lockout cost?')     // EXACT known
const R2 = rep('h_bmw', 'service_scope', ['do', 'you', 'program', 'bmw', 'keys'], 4, 'do you program BMW keys?')    // NOVEL
const R3 = rep('h_lockout_email', 'pricing', ['how', 'much', 'lockout', 'cost'], 7, 'whats the price for a lockout') // SIMILAR to h_lockout (different channel/hash, same wording)
const reps = [R1, R2, R3]

console.log('\n=== Cumulative Business Memory + Planner — demonstration ===\n')
console.log('Existing memory:')
for (const e of memory) console.log(`  • [${e.facet}] "${e.statement}"  conf=${e.confidence}  evidence=${e.evidence_count}`)

line()
const part = partitionPatterns(reps, memory)
console.log('Partition of 3 incoming patterns:')
console.log(`  known   : ${part.known.map((k) => k.rep.patternHash).join(', ') || '—'}`)
console.log(`  similar : ${part.similar.map((s) => `${s.rep.patternHash}→${s.entry.pattern_hash} (jaccard ${jaccard(s.rep.tokens, s.entry.tokens).toFixed(2)})`).join(', ') || '—'}`)
console.log(`  novel   : ${part.novel.map((n) => n.patternHash).join(', ') || '—'}`)

line()
console.log('1) EXISTING pattern seen again → NO LLM, confidence reinforced')
for (const { rep: r, entry: e } of part.known) {
  const next = reinforceConfidence(e.confidence, r.frequency)
  console.log(`   ${r.patternHash}: seen ${r.frequency}× more → confidence ${e.confidence.toFixed(3)} → ${next.toFixed(3)}, evidence ${e.evidence_count} → ${e.evidence_count + r.frequency}  (LLM calls: 0)`)
}

console.log('\n2) NEW pattern → LLM allowed')
for (const n of part.novel) console.log(`   ${n.patternHash} ("${n.messages[0].content}") is novel → queued for paid synthesis`)

console.log('\n3) SIMILAR pattern → merged, NOT duplicated')
for (const { rep: r, entry: e } of part.similar) {
  const next = reinforceConfidence(e.confidence, r.frequency)
  console.log(`   ${r.patternHash} matches existing "${e.statement}" → reinforce that entry (conf ${e.confidence.toFixed(3)} → ${next.toFixed(3)}); no new memory row, no duplicate suggestion, no LLM`)
}

line()
const plan = planLearningJob(reps, memory, { capUSD: 5, phase: 'initial' })
console.log('4) Job estimate BEFORE vs AFTER planner optimization (cap $5)')
console.log(`   before (naive: synthesize all ${reps.length} patterns with Sonnet) : ${usd(plan.estimatedIfNaiveUSD)}`)
console.log(`   after  (planner: only ${plan.processNow.length} novel pattern)       : ${usd(plan.estimatedCostUSD)}`)
console.log('\n5) Cost saved by skip-known logic')
console.log(`   saved this run: ${usd(plan.costSavedUSD)}  (${part.known.length} known + ${part.similar.length} similar skipped)`)
console.log('   planner decisions:')
for (const n of plan.notes) console.log(`     • ${n}`)

// ── Scale scenarios ──────────────────────────────────────────────────────────────
line()
console.log('SCALE — 80,000 emails deterministically collapse to ~60 distinct patterns')
const big: Representative[] = []
for (let i = 0; i < 60; i++) big.push(rep('big_' + i, i % 3 === 0 ? 'pricing' : 'service_scope', ['q', 'variant', String(i)], 1 + (i % 40), 'question ' + i))
const bigMemory: MemoryEntry[] = big.slice(0, 45).map((r) => entry(r.patternHash, r.facet, r.tokens, 0.5, 2, 'known ' + r.patternHash))
const bigPlan = planLearningJob(big, bigMemory, { capUSD: 5, phase: 'initial' })
console.log(`   distinct patterns: 60 | known: ${bigPlan.known.length} | novel: ${bigPlan.novel.length}`)
console.log(`   naive cost (all 60 → Sonnet): ${usd(bigPlan.estimatedIfNaiveUSD)}`)
console.log(`   planned cost (only ${bigPlan.processNow.length} novel): ${usd(bigPlan.estimatedCostUSD)}  |  saved: ${usd(bigPlan.costSavedUSD)}  |  fits $5: ${bigPlan.willFit}`)

line()
console.log('SCALE — "huge enterprise": 300 novel patterns under a tiny $0.10 incremental cap')
const huge: Representative[] = []
for (let i = 0; i < 300; i++) huge.push(rep('huge_' + i, i % 5 === 0 ? 'complaint' : 'other', ['x', String(i)], 1 + (i % 20), 'q' + i))
const hugePlan = planLearningJob(huge, [], { capUSD: 0.1, phase: 'incremental' })
const strong = hugePlan.processNow.filter((p) => p.model === 'strong').length
const cheap = hugePlan.processNow.filter((p) => p.model === 'cheap').length
console.log(`   novel: 300 | process now: ${hugePlan.processNow.length} (Sonnet ${strong}, Haiku ${cheap}) | deferred: ${hugePlan.deferred.length}`)
console.log(`   planned cost: ${usd(hugePlan.estimatedCostUSD)} (never exceeds $0.10) | fits: ${hugePlan.willFit}`)
for (const n of hugePlan.notes) console.log(`     • ${n}`)
console.log('\n=== end ===\n')
