import { anthropic } from '@/lib/anthropic/client'
import { createAdminClient } from '@/lib/supabase/server'
import { amyTools, runTool } from './registry'
import type { SourceContext } from './types'

// Stronger model for the Chief-of-Staff text path — it orchestrates multiple tools,
// calculates, and compares (the realtime voice path stays on Haiku for latency).
const AMY_MODEL = 'claude-sonnet-4-6'

// Amy's core intelligence — a small tool-using loop over the Business Context Layer.
// She RETRIEVES this business's real data before answering. Tenant isolation is enforced
// by the SourceContext (tenantId from the verified session), not by the model.
export async function answerAsAmy(opts: {
  tenantId: string
  question: string
  employeeName?: string
  businessName?: string
}): Promise<string> {
  const ctx: SourceContext = { tenantId: opts.tenantId, db: createAdminClient() }
  const name = opts.employeeName || 'Amy'
  const system = [
    `You are ${name}, the AI Chief of Staff for ${opts.businessName || 'this business'} — an executive advisor, not a chatbot. You are the operating system of THIS business: you can read everything inside its Scalix workspace and nothing about any other business.`,
    `You don't just retrieve — you REASON. Retrieve → analyze → calculate → compare → summarize → recommend. Use your tools:`,
    `• analyze — compute totals, breakdowns, busiest hour/day, percentages, conversion, cancellations. For COMPARISONS, call it once per period (e.g. this_week then last_week) and compare the numbers yourself.`,
    `• search_everything — find every customer who mentioned a topic across all channels.`,
    `• get_conversation_transcript / search_conversations — the actual words said. lookup_contact, get_appointments, get_leads, get_business_metrics, search_knowledge for specifics.`,
    `To find common themes/complaints/requests, retrieve a sample (search_conversations with a higher limit, or search_everything) and identify the patterns yourself. If a calculation needs scanning many records, USE analyze — do not guess and do not refuse.`,
    `It is FORBIDDEN to say "I don't have access", "I can't check", "I don't have a summary/timing", or "I'll check on that". If it exists in this workspace, read or compute it. Only if a tool genuinely returns nothing do you say there's no record yet. NEVER invent numbers, names, or events — state only what the tools return.`,
    `Output like an executive advisor: lead with the answer, give the key numbers, be concise (don't dump raw rows), and when useful finish with "Here's what I recommend…".`,
  ].join('\n')

  const tools = amyTools()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: opts.question }]
  let model = AMY_MODEL

  for (let round = 0; round < 8; round++) {
    let res
    try {
      res = await anthropic.messages.create({ model, max_tokens: 1024, system, tools, messages })
    } catch (e) {
      // If the stronger model isn't available on this account, fall back to Haiku.
      if (model !== 'claude-haiku-4-5') { model = 'claude-haiku-4-5'; res = await anthropic.messages.create({ model, max_tokens: 1024, system, tools, messages }) }
      else throw e
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = res.content as any[]
    const toolUses = blocks.filter((b) => b.type === 'tool_use')
    if (res.stop_reason === 'tool_use' && toolUses.length) {
      messages.push({ role: 'assistant', content: res.content })
      const results = []
      for (const tu of toolUses) {
        const out = await runTool(ctx, tu.name, (tu.input || {}) as Record<string, unknown>)
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
      }
      messages.push({ role: 'user', content: results })
      continue
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    return text || "I looked but couldn't find anything on that."
  }
  return 'I pulled a lot of context but ran out of room — try narrowing the question.'
}
