import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createServiceClient } from '@/lib/supabase/server'
import { stripMarkdown } from '@/lib/utils'
import { assembleBusinessContext } from '@/lib/brain/context/orchestrate'

type Agent = {
  id: string
  name: string | null
  system_prompt: string | null
  business_name: string | null
  personality?: string | null
  industry?: string | null
}

// Generate an email reply, using the agent's prompt + its knowledge base (agent-scoped + tenant-wide
// entries) + the thread so far. Returns plain text (no markdown).
//
// ── WHY THE REPLIES READ AS ROBOTIC, AND WHAT CHANGED ───────────────────────────────────────────
//
// Both of TG's agents have an EMPTY system_prompt, so the whole voice was the six bullet points
// below — "write a professional email reply", "keep it concise" — with no idea who was speaking or
// what the business is. And every reply was written to ONE email with no memory of the thread, so
// the third message in a conversation greeted the customer like a stranger.
//
// So: the conversation so far is passed as prior turns (`history`), the business identity is
// stated in the prompt from the agent row (name, business, industry, personality), and the style
// rules say what a good email from a small business actually looks like — which is mostly what
// NOT to do. The knowledge base is still the source of facts; nothing here invents a price.
export async function generateEmailReply(opts: {
  tenantId: string
  agent: Agent
  tenantBusinessName: string | null
  emailText: string
  subject: string
  /** Earlier turns of this thread, oldest first. Optional; a first email has none. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
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
  const industry = (opts.agent.industry ?? '').trim()
  const personality = (opts.agent.personality ?? '').trim()

  let system = `${opts.agent.system_prompt || ''}

WHO YOU ARE
You are ${name}, writing from ${business}${industry ? ` (${industry})` : ''}. You are replying to a customer's email on behalf of the business — as a knowledgeable, ${personality || 'warm and direct'} member of staff would, not as a call centre.

HOW A GOOD REPLY FROM THIS BUSINESS READS
- Answer the actual question in the first sentence or two. No "Thank you for reaching out", no "I hope this email finds you well", no restating their question back to them.
- Short. Two to five sentences for most emails; a short paragraph or two at most. Only as long as the answer needs.
- Specific to this business: use the facts in the knowledge base (prices, services, hours, location, policies) in your own words. If the knowledge base does not cover something, say you will check and come back, or invite them in — never invent a price, a date or a policy.
- Plain, natural English. Contractions are fine. No corporate filler ("please do not hesitate", "at your earliest convenience", "we value your business"). No exclamation marks in every sentence.
- One clear next step when there is one (book a time, bring the piece in, reply with a photo).
- If they are continuing a thread, continue it — do not re-introduce yourself or repeat what was already said.

FORMAT (strict)
- Start DIRECTLY with the greeting (e.g. "Hi Yoad,"). Do NOT add any label, heading, subject line, or prefix such as "Email Reply" or "Subject:".
- No markdown, no bullet points unless listing three or more distinct items.
- Sign off with your first name and the business name on the last line.
- Never reveal you are an AI unless directly asked.${kb ? `\n\nKNOWLEDGE BASE (the only source of facts about the business):\n${kb}` : ''}`

  // Unified Business Context: inject live module data relevant to the email (catalog, orders, hours…),
  // with the same no-hallucination contract. Best-effort. No contact identity resolved here → customer-scoped
  // providers safely report "unavailable" rather than guessing.
  try {
    const bizContext = await assembleBusinessContext({ tenantId: opts.tenantId, agentId: opts.agent.id ?? null, channel: 'email', query: opts.emailText, contactId: null })
    if (bizContext) system += `\n\n${bizContext}`
  } catch { /* best-effort */ }

  console.log('[email-reply] calling Claude', MODEL, 'kb-entries', kbRows?.length || 0)
  // The thread so far, as alternating turns, then the email being answered. Anthropic requires the
  // turns to alternate and start with the user, so the history is normalised: consecutive same-role
  // turns are merged and a leading assistant turn is dropped.
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const h of (opts.history ?? []).slice(-12)) {
    const content = (h.content || '').trim()
    if (!content) continue
    const last = turns[turns.length - 1]
    if (last && last.role === h.role) last.content += `\n\n${content}`
    else turns.push({ role: h.role, content })
  }
  while (turns.length && turns[0].role === 'assistant') turns.shift()
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop()

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages: [...turns, { role: 'user', content: `Subject: ${opts.subject}\n\n${opts.emailText}` }],
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
