import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createServiceClient } from '@/lib/supabase/server'
import { stripMarkdown } from '@/lib/utils'

type Agent = {
  id: string
  name: string | null
  system_prompt: string | null
  business_name: string | null
}

// Generate a professional email reply, using the agent's prompt + its knowledge
// base (agent-scoped + tenant-wide entries). Returns plain text (no markdown).
export async function generateEmailReply(opts: {
  tenantId: string
  agent: Agent
  tenantBusinessName: string | null
  emailText: string
  subject: string
}): Promise<string> {
  const supabase = await createServiceClient()
  // Same knowledge_base every channel uses: this agent's entries + tenant-wide.
  let kbQuery = supabase.from('knowledge_base').select('title, content').eq('tenant_id', opts.tenantId)
  kbQuery = opts.agent.id
    ? kbQuery.or(`ai_employee_id.eq.${opts.agent.id},ai_employee_id.is.null`)
    : kbQuery.is('ai_employee_id', null)
  const { data: kbRows } = await kbQuery
  const kb = (kbRows || []).map((r) => `## ${r.title}\n${r.content}`).join('\n\n')

  const name = opts.agent.name || 'the team'
  const business = opts.agent.business_name || opts.tenantBusinessName || 'our company'

  const system = `${opts.agent.system_prompt || ''}

CRITICAL FOR EMAIL:
- Write a professional email reply only.
- No markdown, no bullet points in the opening.
- Sign off as ${name} from ${business}.
- Keep the reply concise and helpful.
- Never reveal you are an AI unless directly asked.${kb ? `\n\nKNOWLEDGE BASE:\n${kb}` : ''}`

  console.log('[email-reply] calling Claude', MODEL, 'kb-entries', kbRows?.length || 0)
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: `Subject: ${opts.subject}\n\n${opts.emailText}` }],
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim()
  return stripMarkdown(text)
}
