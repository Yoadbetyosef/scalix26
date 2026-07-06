import { createAdminClient } from '@/lib/supabase/server'
import { llmCost } from './rates'

interface Usage { input_tokens?: number; output_tokens?: number }

/**
 * Record LLM token usage + its cost for a tenant. Best-effort: never throws, never blocks the
 * request that produced it. Exact token counts come from the Anthropic response's `usage`.
 */
export function trackLlm(tenantId: string | undefined, model: string, usage: Usage | undefined): void {
  if (!tenantId || !usage) return
  const inTok = usage.input_tokens || 0
  const outTok = usage.output_tokens || 0
  if (inTok + outTok === 0) return
  // Fire-and-forget; do not await in the hot path.
  ;(async () => {
    try {
      const db = createAdminClient()
      await db.from('usage_events').insert({
        tenant_id: tenantId,
        kind: 'llm',
        provider: 'anthropic',
        model,
        units: inTok + outTok,
        unit_type: 'tokens',
        cost_usd: llmCost(model, inTok, outTok),
      })
    } catch {
      /* best-effort */
    }
  })()
}
