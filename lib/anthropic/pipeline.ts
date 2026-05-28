import { anthropic, MODEL } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import type { AIEmployee, Channel, Message, Skill, KnowledgeBase, Tenant } from '@/types'

interface PipelineInput {
  tenantId: string
  channelType: string
  from: string
  messageContent: string
  conversationId?: string
}

interface PipelineOutput {
  response: string
  conversationId: string
  skillTriggered?: string
}

function buildSystemPrompt(
  tenant: Tenant,
  employee: AIEmployee,
  skills: Skill[],
  kb: KnowledgeBase[]
): string {
  const activeSkills = skills.filter(s => s.active).map(s => `- ${s.name}: ${s.type}`).join('\n')
  const kbContent = kb.map(k => `## ${k.title}\n${k.content}`).join('\n\n')

  const hours = tenant.business_hours
  const hoursStr = Object.entries(hours)
    .map(([day, h]) => `${day}: ${h}`)
    .join(', ')

  return `You are ${employee.name}, an AI assistant for ${tenant.business_name}, a ${tenant.industry || 'home services'} company located in ${tenant.city || ''}, ${tenant.state || ''}.

Business hours: ${hoursStr}
Timezone: ${tenant.timezone}
Phone: ${tenant.phone || 'N/A'}
Email: ${tenant.email || 'N/A'}
Website: ${tenant.website || 'N/A'}

Your personality: ${employee.personality} (score: ${employee.personality_score}/100 — 0=very formal, 100=very friendly)

SKILLS YOU HAVE:
${activeSkills}

KNOWLEDGE BASE:
${kbContent}

RULES:
- Always respond in the same language the customer uses (Spanish if they write in Spanish, English if English, etc.)
- Never make up pricing — if unsure, offer to have someone call back with a quote
- If customer mentions emergency (flood, no heat in winter, gas smell, no electricity, burst pipe) — treat as URGENT, say: "This sounds like an emergency! Please call us immediately at ${tenant.phone || 'our emergency line'}. I'm also alerting our on-call technician right now."
- Always collect: name, phone number, address before booking an appointment
- Be concise for SMS (under 160 chars when possible), more detailed for voice
- Never say you are an AI unless directly asked
- If asked if you are an AI, say: "I'm ${employee.name}, a virtual assistant for ${tenant.business_name}. How can I help you today?"
- For appointment booking, ask: what service do you need? preferred date/time? address? contact info?
- For lead qualification, ask: describe the problem, urgency 1-10, property type, approximate size
- After completing a job (if customer says "thank you" or job is done), offer to send a review link

GREETING (use only at start of new conversation): ${employee.greeting}

Remember: You represent ${tenant.business_name}. Be professional, helpful, and always try to book the appointment or capture the lead.`
}

function detectSkillTrigger(content: string, skills: Skill[]): string | null {
  const lower = content.toLowerCase()

  const emergencyWords = ['emergency', 'flood', 'flooding', 'gas leak', 'no heat', 'no power', 'burst pipe', 'fire', 'urgente', 'emergencia']
  if (emergencyWords.some(w => lower.includes(w))) return 'emergency_routing'

  const bookingWords = ['book', 'schedule', 'appointment', 'available', 'come out', 'send someone', 'reservar', 'cita']
  if (bookingWords.some(w => lower.includes(w))) return 'appointment_booking'

  const reviewWords = ['thank you', 'thanks', 'great job', 'gracias', 'excellent']
  if (reviewWords.some(w => lower.includes(w))) return 'review_request'

  const estimateWords = ['quote', 'estimate', 'how much', 'price', 'cost', 'cuanto', 'precio', 'cotización']
  if (estimateWords.some(w => lower.includes(w))) return 'estimate_request'

  return null
}

export async function runAIPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const supabase = await createServiceClient()

  // 1. Load tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', input.tenantId)
    .single()

  if (!tenant) throw new Error('Tenant not found')

  // 2. Find or create contact
  let contact
  const { data: existingContact } = await supabase
    .from('contacts')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('phone', input.from)
    .single()

  if (existingContact) {
    contact = existingContact
  } else {
    const { data: newContact } = await supabase
      .from('contacts')
      .insert({ tenant_id: input.tenantId, phone: input.from, channel: input.channelType })
      .select()
      .single()
    contact = newContact
  }

  // 3. Find or create conversation
  let conversationId = input.conversationId
  if (!conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .insert({
        tenant_id: input.tenantId,
        contact_id: contact?.id,
        channel: input.channelType,
        status: 'open',
      })
      .select()
      .single()
    conversationId = conv?.id
  }

  // 4. Load AI employee + skills + knowledge base
  const { data: employee } = await supabase
    .from('ai_employees')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('status', 'active')
    .single()

  if (!employee) throw new Error('No active AI employee found')

  const { data: skills } = await supabase
    .from('skills')
    .select('*')
    .eq('ai_employee_id', employee.id)

  const { data: kb } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('tenant_id', input.tenantId)

  // 5. Load conversation history (last 20 messages)
  const { data: history } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true })
    .limit(20)

  // 6. Build system prompt
  const systemPrompt = buildSystemPrompt(tenant, employee, skills || [], kb || [])

  // 7. Save user message
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: input.tenantId,
    role: 'user',
    content: input.messageContent,
    channel: input.channelType,
  })

  // 8. Detect skill trigger
  const skillTriggered = detectSkillTrigger(input.messageContent, skills || [])

  // 9. Call Claude
  const messages = (history || []).map((m: Message) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Add current message
  messages.push({ role: 'user', content: input.messageContent })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages,
  })

  const aiResponse = response.content[0].type === 'text' ? response.content[0].text : ''

  // 10. Save AI response
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    tenant_id: input.tenantId,
    role: 'assistant',
    content: aiResponse,
    channel: input.channelType,
  })

  // 11. Update conversation updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  // 12. Update contact last_interaction
  if (contact) {
    await supabase
      .from('contacts')
      .update({ last_interaction: new Date().toISOString() })
      .eq('id', contact.id)
  }

  // 13. Log analytics event
  await supabase.from('analytics_events').insert({
    tenant_id: input.tenantId,
    event_type: 'message_handled',
    data: { channel: input.channelType, skill_triggered: skillTriggered, conversation_id: conversationId },
  })

  // 14. Async: generate summary
  generateConversationSummary(conversationId!, input.tenantId).catch(console.error)

  return {
    response: aiResponse,
    conversationId: conversationId!,
    skillTriggered: skillTriggered || undefined,
  }
}

async function generateConversationSummary(conversationId: string, tenantId: string) {
  const supabase = await createServiceClient()

  const { data: messages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true })
    .limit(30)

  if (!messages || messages.length < 2) return

  const transcript = messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')

  const summary = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Summarize this customer conversation in 2-3 sentences. Include: what the customer needed, what the AI did, and the outcome.\n\n${transcript}`,
    }],
  })

  const summaryText = summary.content[0].type === 'text' ? summary.content[0].text : ''

  await supabase
    .from('conversations')
    .update({ summary: summaryText })
    .eq('id', conversationId)
}
