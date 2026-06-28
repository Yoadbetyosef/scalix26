import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createAdminClient } from '@/lib/supabase/server'
import { amyTools, runTool } from './registry'
import type { SourceContext } from './types'

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
    `You are ${name}, the AI chief of staff for ${opts.businessName || 'this business'}. You are the operating system of THIS business — you know everything inside its Scalix workspace and nothing about any other business.`,
    `Before answering, RETRIEVE the relevant data with your tools (conversations & transcripts, contacts, appointments, leads, metrics, knowledge base). NEVER say "I don't have access" — if it exists in this workspace, look it up. NEVER invent numbers, names, or events; only state what the tools return.`,
    `Speak like a trusted employee: first person ("I handled…", "I'd recommend…"), concise, useful. After answering, you may add one short recommended action. Keep it to a few sentences.`,
  ].join('\n')

  const tools = amyTools()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: opts.question }]

  for (let round = 0; round < 5; round++) {
    const res = await anthropic.messages.create({ model: MODEL, max_tokens: 700, system, tools, messages })
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
