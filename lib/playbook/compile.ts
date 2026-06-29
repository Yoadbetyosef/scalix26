import { type OwnerPlaybook, PLAYBOOK_SECTIONS } from './types'

// Markers that fence the managed playbook block inside ai_employees.system_prompt.
// Approval strips any existing block (between these, inclusive) and re-appends a fresh
// one — idempotent, so re-approving never duplicates. The owner's free-text custom
// instructions live OUTSIDE the block and are always preserved.
export const PLAYBOOK_START = '═══ SCALIX PLAYBOOK — managed by Scalix, do not edit below ═══'
export const PLAYBOOK_END = '═══ END SCALIX PLAYBOOK ═══'

// Keep the compiled block tight so the voice prompt (embedded in the TwiML/WS payload)
// stays fast and small. Text channels could take more, but one capped block keeps every
// channel consistent and predictable.
const MAX_CHARS = 2000
const MAX_LIST_ITEMS = 8
const MAX_EXAMPLES = 4

function section(label: string, body: string): string {
  return `${label.toUpperCase()}:\n${body}`
}

/**
 * Compile the structured playbook into a concise, prompt-ready text block. Behavior-
 * critical sections come first so that if the budget truncates, the safety rules survive.
 */
export function compilePlaybook(pb: OwnerPlaybook): string {
  const blocks: string[] = []

  // Order for compilation: identity → safety/operating rules → behavior → examples.
  // (UI order in PLAYBOOK_SECTIONS is for editing; this order is for the model.)
  const textIntro = [
    pb.business_summary && pb.business_summary,
    pb.tone_profile && `Tone: ${pb.tone_profile}`,
    pb.response_style && `Style: ${pb.response_style}`,
    pb.sales_style && `Sales approach: ${pb.sales_style}`,
  ]
    .filter(Boolean)
    .join(' ')
  if (textIntro) blocks.push(`You answer exactly as the business owner would. ${textIntro}`)

  const listOrder: (keyof OwnerPlaybook)[] = [
    'uncertainty_rules',
    'escalation_rules',
    'pricing_rules',
    'booking_rules',
    'emergency_rules',
    'do_not_say',
    'do_say',
    'objection_handling',
    'qualification_rules',
    'high_value_signals',
    'low_value_signals',
    'follow_up_rules',
    'channel_rules',
    'services_products',
  ]
  const labelOf = (k: keyof OwnerPlaybook) => PLAYBOOK_SECTIONS.find((s) => s.key === k)?.label || String(k)

  for (const key of listOrder) {
    const items = (pb[key] as string[]) || []
    if (!items.length) continue
    const body = items.slice(0, MAX_LIST_ITEMS).map((i) => `- ${i}`).join('\n')
    blocks.push(section(labelOf(key), body))
  }

  if (pb.common_questions.length) {
    const body = pb.common_questions
      .slice(0, MAX_EXAMPLES)
      .map((e) => `Q: ${e.customer}\nA: ${e.reply}`)
      .join('\n')
    blocks.push(section('Common questions', body))
  }
  if (pb.examples.length) {
    const body = pb.examples
      .slice(0, MAX_EXAMPLES)
      .map((e) => `Customer: ${e.customer}\nOwner: ${e.reply}`)
      .join('\n')
    blocks.push(section("Owner's own phrasing (match this voice)", body))
  }

  // Assemble within budget: keep adding whole blocks until we'd exceed MAX_CHARS.
  let out = ''
  for (const b of blocks) {
    if (out.length + b.length + 2 > MAX_CHARS) break
    out += (out ? '\n\n' : '') + b
  }
  return out.trim()
}

/** Remove any existing managed playbook block, returning just the owner's raw text. */
export function stripPlaybookBlock(systemPrompt: string | null | undefined): string {
  const sp = systemPrompt || ''
  const start = sp.indexOf(PLAYBOOK_START)
  if (start === -1) return sp.trim()
  const endIdx = sp.indexOf(PLAYBOOK_END, start)
  const before = sp.slice(0, start)
  const after = endIdx === -1 ? '' : sp.slice(endIdx + PLAYBOOK_END.length)
  return (before + after).replace(/\n{3,}/g, '\n\n').trim()
}

/** Compose the final system_prompt: owner's raw instructions + the managed playbook block. */
export function composeSystemPrompt(systemPrompt: string | null | undefined, compiled: string): string {
  const raw = stripPlaybookBlock(systemPrompt)
  if (!compiled.trim()) return raw
  const block = `${PLAYBOOK_START}\n${compiled.trim()}\n${PLAYBOOK_END}`
  return raw ? `${raw}\n\n${block}` : block
}
