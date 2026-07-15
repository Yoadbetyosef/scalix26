import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createServiceClient } from '@/lib/supabase/server'
import { stripMarkdown } from '@/lib/utils'
import { assembleBusinessContext } from '@/lib/brain/context/orchestrate'

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

  let system = `${opts.agent.system_prompt || ''}

CRITICAL FOR EMAIL:
- Write a professional email reply only.
- Start DIRECTLY with the greeting (e.g. "Hi Yoad,"). Do NOT add any label, heading, subject line, or prefix such as "Email Reply", "EMAIL REPLY", or "Subject:".
- No markdown, no bullet points in the opening.
- Sign off as ${name} from ${business}.
- Keep the reply concise and helpful.
- Never reveal you are an AI unless directly asked.${kb ? `\n\nKNOWLEDGE BASE:\n${kb}` : ''}`

  // Unified Business Context: inject live module data relevant to the email (catalog, orders, hours…),
  // with the same no-hallucination contract. Best-effort. No contact identity resolved here → customer-scoped
  // providers safely report "unavailable" rather than guessing.
  try {
    const bizContext = await assembleBusinessContext({ tenantId: opts.tenantId, agentId: opts.agent.id ?? null, channel: 'email', query: opts.emailText, contactId: null })
    if (bizContext) system += `\n\n${bizContext}`
  } catch { /* best-effort */ }

  console.log('[email-reply] calling Claude', MODEL, 'kb-entries', kbRows?.length || 0)
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: `Subject: ${opts.subject}\n\n${opts.emailText}` }],
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim()
  return stripMarkdown(stripLeadingLabel(text))
}

// Strip any leaked channel/label prefix the model sometimes puts at the very top
// (e.g. "EMAIL REPLY", "Email Reply:", "Subject: …") so the body starts at the greeting.
function stripLeadingLabel(s: string): string {
  let out = s
  // Drop a leading "Subject: ..." line if present.
  out = out.replace(/^\s*subject\s*:.*(?:\r?\n)+/i, '')
  // Drop a leading "Email Reply" / "EMAIL REPLY" label (optional colon), incl. its line break.
  out = out.replace(/^\s*email[\s_-]*reply\s*:?\s*(?:\r?\n)*/i, '')
  return out.trimStart()
}
