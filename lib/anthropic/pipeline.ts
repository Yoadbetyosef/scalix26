import { anthropic, MODEL, VOICE_MODEL } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import type { AIEmployee, Message, Skill, KnowledgeBase, Tenant, BusinessHours } from '@/types'

interface PipelineInput {
  tenantId: string
  agentId?: string
  channelType: string
  from: string
  messageContent: string
  conversationId?: string
}

interface PipelineOutput {
  response: string
  conversationId: string
  skillTriggered?: string
  /** True when a human has taken over the conversation; AI did not respond. */
  skipped?: boolean
}

// Voice-only rules — prepended to the system prompt for phone calls (channel
// = 'voice'). SMS/WhatsApp/social are NOT restricted by this; they can be longer.
const VOICE_CALL_RULES = `VOICE CALL - CRITICAL RULES:
- You are on a live phone call. Be a human, not a chatbot.
- Maximum 1-2 short sentences per response. Never more.
- No lists, no bullet points, no long explanations.
- No filler phrases like "Certainly!", "Great!", "Of course!"
- Ask only ONE question at a time.
- If caller wants to book — book immediately, no explanations.
- Fast, warm, natural. Like your best receptionist.`

function buildSystemPrompt(
  employee: AIEmployee,
  skills: Skill[],
  kb: KnowledgeBase[],
  tenant: Tenant,
  isVoice: boolean
): string {
  // Employee fields take priority; fall back to tenant for accounts that haven't migrated
  const businessName = employee.business_name || tenant.business_name
  const industry = employee.industry || tenant.industry
  const city = employee.city || tenant.city
  const state = employee.state || tenant.state
  const phone = employee.phone || tenant.phone
  const email = employee.email || tenant.email
  const website = employee.website || tenant.website
  const hours: BusinessHours | Record<string, string> = employee.business_hours || tenant.business_hours || {}
  const timezone = employee.timezone || tenant.timezone

  const activeSkills = skills.filter(s => s.active).map(s => `- ${s.name}: ${s.type}`).join('\n')
  const kbContent = kb.map(k => `## ${k.title}\n${k.content}`).join('\n\n')

  const hoursStr = Object.entries(hours)
    .map(([day, h]) => `${day}: ${h}`)
    .join(', ') || 'Not specified'

  const basePrompt = `You are ${employee.name}, an AI assistant for ${businessName}, a ${industry || 'home services'} company located in ${city || ''}, ${state || ''}.

Business hours: ${hoursStr}
Timezone: ${timezone}
Phone: ${phone || 'N/A'}
Email: ${email || 'N/A'}
Website: ${website || 'N/A'}

Your personality: ${employee.personality} (score: ${employee.personality_score}/100 — 0=very formal, 100=very friendly)

SKILLS YOU HAVE:
${activeSkills}

KNOWLEDGE BASE:
${kbContent}

RULES:
- Always respond in the same language the customer uses (Spanish if they write in Spanish, English if English, etc.)
- Never make up pricing — if unsure, offer to have someone call back with a quote
- If customer mentions emergency (flood, no heat in winter, gas smell, no electricity, burst pipe) — treat as URGENT, say: "This sounds like an emergency! Please call us immediately at ${phone || 'our emergency line'}. I'm also alerting our on-call technician right now."
- Always collect: name, phone number, address before booking an appointment
- Be concise for SMS (under 160 chars when possible), more detailed for voice
- Never say you are an AI unless directly asked
- If asked if you are an AI, say: "I'm ${employee.name}, a virtual assistant for ${businessName}. How can I help you today?"
- For appointment booking, ask: what service do you need? preferred date/time? address? contact info?
- For lead qualification, ask: describe the problem, urgency 1-10, property type, approximate size
- After completing a job (if customer says "thank you" or job is done), offer to send a review link

GREETING (use only at start of new conversation): ${employee.greeting}

Remember: You represent ${businessName}. Be professional, helpful, and always try to book the appointment or capture the lead.`

  // Voice calls get the strict brevity rules prepended before everything else
  return isVoice ? `${VOICE_CALL_RULES}\n\n${basePrompt}` : basePrompt
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
  const isVoice = input.channelType === 'voice'

  // Load tenant + contact in parallel; employee loaded separately based on agentId
  const [tenantRes, contactRes, employeeRes, kbRes] = await Promise.all([
    supabase.from('tenants').select('*').eq('id', input.tenantId).single(),
    supabase.from('contacts').select('*').eq('tenant_id', input.tenantId).eq('phone', input.from).maybeSingle(),
    input.agentId
      ? supabase.from('ai_employees').select('*').eq('id', input.agentId).single()
      : supabase.from('ai_employees').select('*').eq('tenant_id', input.tenantId).eq('status', 'active').maybeSingle(),
    supabase.from('knowledge_base').select('*').eq('tenant_id', input.tenantId),
  ])

  const tenant = tenantRes.data
  if (!tenant) throw new Error('Tenant not found')

  const employee = employeeRes.data
  if (!employee) throw new Error('No active AI employee found')

  const kb = kbRes.data

  // Create contact if missing
  let contact = contactRes.data
  if (!contact) {
    const { data: newContact } = await supabase
      .from('contacts')
      .insert({ tenant_id: input.tenantId, phone: input.from, channel: input.channelType })
      .select()
      .single()
    contact = newContact
  }

  // Find existing open conversation for this contact on this channel
  let conversationId = input.conversationId
  let humanTakeover = false
  if (!conversationId && contact?.id) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id, human_takeover')
      .eq('tenant_id', input.tenantId)
      .eq('contact_id', contact.id)
      .eq('channel', input.channelType)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      conversationId = existing.id
      humanTakeover = existing.human_takeover === true
    }
  } else if (conversationId) {
    // Conversation id passed in directly (e.g. voice) — fetch its takeover state
    const { data: existing } = await supabase
      .from('conversations')
      .select('human_takeover')
      .eq('id', conversationId)
      .maybeSingle()
    humanTakeover = existing?.human_takeover === true
  }

  // Human has taken over: record the inbound customer message so it shows in the
  // inbox, but do NOT generate or send an AI reply.
  if (humanTakeover && conversationId) {
    const nowTs = new Date().toISOString()
    Promise.all([
      supabase.from('messages').insert([
        { conversation_id: conversationId, tenant_id: input.tenantId, role: 'user', content: input.messageContent, channel: input.channelType },
      ]),
      supabase.from('conversations').update({ updated_at: nowTs }).eq('id', conversationId),
      contact ? supabase.from('contacts').update({ last_interaction: nowTs }).eq('id', contact.id) : Promise.resolve(null),
    ]).catch(console.error)

    return { response: '', conversationId, skipped: true }
  }

  // Load skills + conversation history + create conversation if needed
  const [skillsRes, historyRes, convRes] = await Promise.all([
    supabase.from('skills').select('*').eq('ai_employee_id', employee.id),
    conversationId
      ? supabase.from('messages').select('role, content').eq('conversation_id', conversationId)
          .order('timestamp', { ascending: true }).limit(isVoice ? 6 : 20)
      : Promise.resolve({ data: [] }),
    conversationId
      ? Promise.resolve({ data: { id: conversationId } })
      : supabase.from('conversations').insert({
          tenant_id: input.tenantId,
          ai_employee_id: employee.id,
          contact_id: contact?.id,
          channel: input.channelType,
          status: 'open',
        }).select('id').single(),
  ])

  if (!conversationId) conversationId = (convRes as { data: { id: string } | null }).data?.id

  const skills = skillsRes.data || []
  const history = historyRes.data || []
  const skillTriggered = detectSkillTrigger(input.messageContent, skills)

  const systemPrompt = buildSystemPrompt(employee, skills, kb || [], tenant, isVoice)
  const voiceRules = `

VOICE CALL RULES — OVERRIDE EVERYTHING ELSE:
- Max 2-3 sentences. Never more.
- No lists, bullet points, or numbered items. Speak in natural sentences only.
- Get to the point in the first sentence — no warm-up phrases.
- Tone: friendly, confident, like a real receptionist. Never robotic or formal.
- Never say "Great question!", "Absolutely!", "Certainly!" or any filler opener.
- First priority on every call: get the caller's location and what the problem is.
- Second priority: confirm you can help and book the job.
- Every response must end with a clear next step or question.
- Never say "I am an AI" or anything that reveals you are not human.
- If you don't know something, say "Let me get someone to help you with that" — never guess.
- Feel urgent and helpful. The caller has a problem and needs it solved now.`

  const chatMessages = (history as Message[]).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  chatMessages.push({ role: 'user', content: input.messageContent })

  const response = await anthropic.messages.create({
    model: isVoice ? VOICE_MODEL : MODEL,
    max_tokens: isVoice ? 120 : 500,
    system: isVoice ? systemPrompt + voiceRules : systemPrompt,
    messages: chatMessages,
  })

  const aiResponse = response.content[0].type === 'text' ? response.content[0].text : ''

  const now = new Date().toISOString()
  Promise.all([
    supabase.from('messages').insert([
      { conversation_id: conversationId, tenant_id: input.tenantId, role: 'user', content: input.messageContent, channel: input.channelType },
      { conversation_id: conversationId, tenant_id: input.tenantId, role: 'assistant', content: aiResponse, channel: input.channelType },
    ]),
    conversationId
      ? supabase.from('conversations').update({ updated_at: now }).eq('id', conversationId)
      : Promise.resolve(null),
    contact
      ? supabase.from('contacts').update({ last_interaction: now }).eq('id', contact.id)
      : Promise.resolve(null),
    supabase.from('analytics_events').insert({
      tenant_id: input.tenantId,
      event_type: 'message_handled',
      data: { channel: input.channelType, skill_triggered: skillTriggered, conversation_id: conversationId },
    }),
  ]).catch(console.error)

  if (!isVoice) {
    generateConversationSummary(conversationId!, input.tenantId).catch(console.error)
  }

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
