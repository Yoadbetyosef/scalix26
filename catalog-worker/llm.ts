// The tier-5 extractor, and the only place in this service that spends money.
//
// Every call is metered into usage_events the moment it returns, in the same shape lib/billing/meter
// writes from the app: real provider cost from the shared rate card, markup snapshotted for White
// Label clients, deduped by the Anthropic completion id. AI spend that isn't written down is how a
// feature like this quietly stops being profitable — so the write happens here, next to the call,
// rather than being something the caller might remember to do.
import Anthropic from '@anthropic-ai/sdk'
import { llmCost } from '../lib/cost/rates'
import { computeCharge, pickMarkupPct, type MarkupRow } from '../lib/billing/pricing'
import { db } from './db'
import type { LlmExtractor, Telemetry } from '../lib/ingestion/types'

const MODEL = 'claude-haiku-4-5'          // the app's default model; extraction is not a reasoning task

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })

// Resolved once per tenant per process: the markup config changes rarely and a 100-page crawl should
// not ask for it a hundred times.
const markupCache = new Map<string, { partnerId: string | null; markupPct: number }>()

async function pricingFor(tenantId: string): Promise<{ partnerId: string | null; markupPct: number }> {
  const hit = markupCache.get(tenantId)
  if (hit) return hit

  const { data: tenant } = await db.from('tenants').select('white_label_partner_id').eq('id', tenantId).maybeSingle()
  const partnerId = (tenant?.white_label_partner_id as string) ?? null

  let query = db.from('billing_markup_config').select('scope, partner_id, markup_pct, currency').eq('active', true).eq('currency', 'usd')
  query = partnerId ? query.or(`scope.eq.global,partner_id.eq.${partnerId}`) : query.eq('scope', 'global')
  const { data: rows } = await query

  const resolved = { partnerId, markupPct: pickMarkupPct((rows as MarkupRow[]) ?? [], partnerId, 'usd') }
  markupCache.set(tenantId, resolved)
  return resolved
}

async function meter(tenantId: string, inputTokens: number, outputTokens: number, requestId: string): Promise<number> {
  const costUsd = llmCost(MODEL, inputTokens, outputTokens)
  try {
    const { partnerId, markupPct } = await pricingFor(tenantId)
    await db.from('usage_events').upsert({
      tenant_id: tenantId,
      customer_id: null,
      partner_id: partnerId,
      provider: 'anthropic',
      kind: 'llm',
      category: 'ai',
      resource_id: requestId,
      model: MODEL,
      units: inputTokens + outputTokens,
      unit_type: 'token',
      cost_usd: costUsd,
      markup_percent: partnerId ? markupPct : null,
      partner_charge_cents: partnerId ? computeCharge(costUsd * 100, markupPct) : null,
      currency: 'usd',
      billing_version: 1,
      pricing_rule_id: null,
      metadata: { surface: 'catalog_ingestion' },
      priced: false,
    })
  } catch (e) {
    // Metering must never take a run down with it — but unlike the app, we say so loudly, because a
    // silent gap here is spend nobody sees.
    console.error('[catalog-worker] metering failed:', (e as Error).message)
  }
  return costUsd
}

// Pull the JSON object out of a completion that may have wrapped it in prose or a fence, despite
// being asked not to.
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  try { return JSON.parse(candidate) } catch { /* fall through */ }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
  throw new Error('model did not return JSON')
}

export function makeExtractor(tenantId: string, telemetry: Telemetry): LlmExtractor {
  return {
    async extract({ prompt, maxTokens = 700 }) {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0,                       // extraction, not writing — the same page must give the same answer
        messages: [{ role: 'user', content: prompt }],
      })
      const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
      const inputTokens = res.usage?.input_tokens ?? 0
      const outputTokens = res.usage?.output_tokens ?? 0

      // Metered before parsing: the tokens were spent whether or not the answer was usable.
      telemetry.llmCostUsd += await meter(tenantId, inputTokens, outputTokens, res.id)

      return { json: parseJson(text), inputTokens, outputTokens, model: MODEL, requestId: res.id }
    },
  }
}
