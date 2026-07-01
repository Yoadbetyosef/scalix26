import { anthropic } from '@/lib/anthropic/client'
import { MODEL_TIERS, type ModelTier } from './config'
import type { LearningBudget } from './budget'

// Single LLM call for asynchronous learning (never in the customer hot path). When a
// `budget` is supplied the call is gated + costed by LearningBudget; the `tier` picks the
// model (cheap for classification, strong for final hypotheses). If the tier model fails,
// we fall back to the cheap model. Callers should ALWAYS pass a budget — the ungated path
// below exists only so nothing breaks if an old caller is missed.
export async function callModel(
  prompt: string,
  maxTokens = 1800,
  opts: { budget?: LearningBudget; tier?: ModelTier } = {},
): Promise<string> {
  const tier: ModelTier = opts.tier ?? 'strong'

  const invoke = async (): Promise<{ text: string; inTok?: number; outTok?: number }> => {
    try {
      const r = await anthropic.messages.create({ model: MODEL_TIERS[tier], max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
      return { text: r.content[0]?.type === 'text' ? r.content[0].text : '', inTok: r.usage?.input_tokens, outTok: r.usage?.output_tokens }
    } catch {
      const r = await anthropic.messages.create({ model: MODEL_TIERS.cheap, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
      return { text: r.content[0]?.type === 'text' ? r.content[0].text : '', inTok: r.usage?.input_tokens, outTok: r.usage?.output_tokens }
    }
  }

  if (opts.budget) return opts.budget.call(tier, prompt, maxTokens, invoke)
  return (await invoke().catch(() => ({ text: '' }))).text
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractJsonArray(s: string): any[] {
  const m = s.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const v = JSON.parse(m[0])
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
