import { anthropic } from '@/lib/anthropic/client'

const PRIMARY = 'claude-sonnet-4-6'
const FALLBACK = 'claude-haiku-4-5'

// Single LLM call with model fallback. Used only for asynchronous learning (never in the
// customer hot path), so latency isn't a concern.
export async function callModel(prompt: string, maxTokens = 1800): Promise<string> {
  let model = PRIMARY
  try {
    const r = await anthropic.messages.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    return r.content[0]?.type === 'text' ? r.content[0].text : ''
  } catch {
    model = FALLBACK
    try {
      const r = await anthropic.messages.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
      return r.content[0]?.type === 'text' ? r.content[0].text : ''
    } catch {
      return ''
    }
  }
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
