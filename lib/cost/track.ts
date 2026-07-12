import { randomUUID } from 'crypto'
import { llmCost } from './rates'
import { meterUsage } from '@/lib/billing/meter'

interface Usage { input_tokens?: number; output_tokens?: number }

/**
 * Record LLM token usage for a tenant. Routes through the immutable universal meter (lib/billing/meter):
 * writes a self-describing usage_events row (real provider = anthropic, exact tokens, snapshotted
 * provider cost + markup + partner charge) and — for White Label client tenants — makes it billable to
 * the partner balance. Best-effort, never blocks. Pass the Anthropic completion `id` as resourceId so
 * events are deterministic + deduped; customerId is the end contact when available.
 */
export function trackLlm(
  tenantId: string | undefined,
  model: string,
  usage: Usage | undefined,
  opts?: { resourceId?: string; customerId?: string | null },
): void {
  if (!tenantId || !usage) return
  const inTok = usage.input_tokens || 0
  const outTok = usage.output_tokens || 0
  if (inTok + outTok === 0) return
  meterUsage({
    tenantId,
    category: 'ai',
    provider: 'anthropic',
    metric: 'token',
    quantity: inTok + outTok,
    providerCostUsd: llmCost(model, inTok, outTok),
    resourceId: opts?.resourceId || `llm:${randomUUID()}`, // real completion id when passed → deterministic dedup
    customerId: opts?.customerId ?? null,
    model,
    kind: 'llm', // legacy kind kept for the existing admin COGS view
  })
}
