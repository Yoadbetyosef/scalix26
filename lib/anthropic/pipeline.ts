import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL, VOICE_MODEL } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import { bookingInProgress, extractBookingFields, buildBookingStatus } from './booking'
import { BOOKING_TOOLS, executeBookingTool, type BookingToolCtx } from './booking-tools'
import { FINANCIAL_TOOLS, executeFinancialTool, isFinancialTool, isFinancialCapabilityAvailable, detectFinancialIntent, financialIntentPrompt } from './financial-intent'
import { CATALOG_TOOLS, executeCatalogTool, isCatalogTool, detectCatalogIntent, catalogPromptGuidance } from './catalog-tools'
import { currentDateContext } from '@/lib/appointments'
import { catalogPromptLine } from '@/lib/stripe/connect'
import { normalizePaymentSettings } from '@/lib/stripe/payment-collection'
import { getRecognitionContext, recognitionPromptBlock } from '@/lib/customer/recognition'
import { enabledModulesOf } from '@/lib/modules'
import { trackLlm } from '@/lib/cost/track'
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

// Personality is no longer configurable per agent — use one sensible default
// tone. Shared by the SMS/WhatsApp pipeline and the realtime voice route.
export const DEFAULT_TONE = 'You communicate in a warm, friendly, and professional tone.'

function buildSystemPrompt(
  employee: AIEmployee,
  skills: Skill[],
  kb: KnowledgeBase[],
  tenant: Tenant,
  isVoice: boolean,
  bookingStatus = ''
): string {
  // Employee fields take priority; fall back to tenant for accounts that haven't migrated
  const businessName = employee.business_name || tenant.business_name
  const industry = employee.industry || tenant.industry
  const city = employee.city || tenant.city
  const state = employee.state || tenant.state
  const phone = employee.phone || tenant.phone
  const email = employee.email || tenant.email
  const website = employee.website || tenant.website
  const timezone = employee.timezone || tenant.timezone

  const activeSkills = skills.filter(s => s.active).map(s => `- ${s.name}: ${s.type}`).join('\n')
  const kbContent = kb.map(k => `## ${k.title}\n${k.content}`).join('\n\n')

  // Informational opening hours (business_hours JSON) — what the AI tells callers
  // who ask "what are your hours?". This is NOT appointment availability (slots).
  const hours: BusinessHours | Record<string, string> = employee.business_hours || tenant.business_hours || {}
  const hoursStr = Object.entries(hours).map(([day, h]) => `${day}: ${h}`).join(', ') || 'Not specified'

  const basePrompt = `${DEFAULT_TONE}

You are ${employee.name}, an AI assistant for ${businessName}, a ${industry || 'home services'} company located in ${city || ''}, ${state || ''}.

Business hours: ${hoursStr}
${currentDateContext(timezone)}
Phone: ${phone || 'N/A'}
Email: ${email || 'N/A'}
Website: ${website || 'N/A'}

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
- For appointment booking, collect these ONE AT A TIME (never ask for several at once): service, preferred date, preferred time, name, phone, address. Never re-ask for a detail the customer already gave or that you already confirmed. Once you have all of them, confirm the full booking once and stop.
- For lead qualification, ask: describe the problem, urgency 1-10, property type, approximate size
- After completing a job (if customer says "thank you" or job is done), offer to send a review link

GREETING (use only at start of new conversation): ${employee.greeting}

Remember: You represent ${businessName}. Be professional, helpful, and always try to book the appointment or capture the lead.`

  // Per-turn booking state goes last (highest recency = best adherence).
  const booking = bookingStatus ? `\n\n${bookingStatus}` : ''

  // Voice calls get the strict brevity rules prepended before everything else
  if (isVoice) return `${VOICE_CALL_RULES}\n\n${basePrompt}${booking}`

  // SMS/WhatsApp render plain text — markdown shows up as literal **asterisks**.
  return `${basePrompt}

FORMAT: Plain text only. Never use markdown — no asterisks (* or **), underscores, backticks, headers, or bullet/numbered lists. Keep every reply to 1–2 short sentences; these are text messages, not emails. Ask only ONE question per message — never request multiple details at once. Sound like a real person texting, not a form.${booking}`
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
  // Per-tenant module entitlements gate the AI's tools: booking tools require `scheduling`,
  // estimate handling requires `estimates`. Disabled modules → the tool/skill is never offered.
  const enabledModules = enabledModulesOf(tenant)

  const employee = employeeRes.data
  if (!employee) throw new Error('No active AI employee found')

  // Scope KB to this agent (plus any tenant-wide entries) — not other agents'.
  const kb = (kbRes.data || []).filter(
    (k) => !(k as { ai_employee_id?: string | null }).ai_employee_id || (k as { ai_employee_id?: string | null }).ai_employee_id === employee.id,
  )

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

  let conversationId = input.conversationId

  // Records the inbound customer message (no AI reply) when a human has taken over.
  const recordTakeoverAndSkip = (): PipelineOutput => {
    const nowTs = new Date().toISOString()
    Promise.all([
      supabase.from('messages').insert([
        { conversation_id: conversationId, tenant_id: input.tenantId, role: 'user', content: input.messageContent, channel: input.channelType },
      ]),
      supabase.from('conversations').update({ updated_at: nowTs }).eq('id', conversationId),
      contact ? supabase.from('contacts').update({ last_interaction: nowTs }).eq('id', contact.id) : Promise.resolve(null),
    ]).catch(console.error)
    return { response: '', conversationId: conversationId!, skipped: true }
  }

  // Find existing open conversation for this contact (SMS + first voice turn).
  // When a conversationId is passed in (e.g. voice), takeover is fetched in the
  // Promise.all below instead — saving a serial round-trip.
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
      if (existing.human_takeover === true) return recordTakeoverAndSkip()
    }
  }

  // Load skills + history + takeover (passed-in convo only) + create conversation if needed
  const [skillsRes, historyRes, takeoverRes, convRes] = await Promise.all([
    supabase.from('skills').select('*').eq('ai_employee_id', employee.id),
    conversationId
      ? supabase.from('messages').select('role, content').eq('conversation_id', conversationId)
          .order('timestamp', { ascending: !isVoice }).limit(isVoice ? 6 : 20)
      : Promise.resolve({ data: [] }),
    input.conversationId
      ? supabase.from('conversations').select('human_takeover').eq('id', input.conversationId).maybeSingle()
      : Promise.resolve({ data: null }),
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

  // Takeover check for the passed-in conversationId path (voice subsequent turns)
  if (input.conversationId && (takeoverRes.data as { human_takeover?: boolean } | null)?.human_takeover === true) {
    return recordTakeoverAndSkip()
  }

  const skills = skillsRes.data || []
  const history = historyRes.data || []

  // Financial Intent — available ONLY when the Payment Collection skill is ON and Stripe
  // Connect is active. Drives both the prompt injection and whether we enter the tool turn.
  const financialAvailable = !isVoice && isFinancialCapabilityAvailable(skills, tenant)
  const financialIntent = financialAvailable && detectFinancialIntent(input.messageContent)
  let skillTriggered = (financialIntent ? 'payment_collection' : null) || detectSkillTrigger(input.messageContent, skills)
  // Estimate handling is gated by the `estimates` module.
  if (skillTriggered === 'estimate_request' && !enabledModules.includes('estimates')) skillTriggered = null

  // Voice: trim KB to the first 500 chars of one row; SMS/social use full KB
  const kbForPrompt = isVoice
    ? (kb?.[0]?.content ? [{ title: 'Business info', content: String(kb[0].content).substring(0, 500) }] : [])
    : (kb || [])
  // Voice loads the 6 NEWEST messages (descending) — reverse back to chronological
  const orderedHistory = isVoice ? [...(history as Message[])].reverse() : (history as Message[])
  const chatMessages = orderedHistory.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  chatMessages.push({ role: 'user', content: input.messageContent })

  // Booking flow: derive which fields are already collected from the whole
  // conversation (customer messages + the AI's own confirmations) and inject a
  // "collected so far" summary so the AI never re-asks for details it has.
  const inBooking = enabledModules.includes('scheduling') && bookingInProgress(chatMessages)
  // Business Catalog (inventory module): let the AI look up real availability on demand.
  const catalogEnabled = enabledModules.includes('inventory')
  const catalogIntent = catalogEnabled && !isVoice && detectCatalogIntent(input.messageContent)
  let bookingStatus = ''
  if (inBooking) {
    bookingStatus = buildBookingStatus(await extractBookingFields(chatMessages))
  }

  let systemPrompt = buildSystemPrompt(employee, skills, kbForPrompt, tenant, isVoice, bookingStatus)

  // Catalog awareness (text channels, inventory module on) — tells the AI it can look up real
  // stock and must never invent inventory.
  if (catalogEnabled && !isVoice) systemPrompt += `\n\n${catalogPromptGuidance()}`

  // Financial Intent prompt — injected ONLY when the capability is available (skill ON +
  // Stripe connected). Includes the real product catalog so the AI can take a payment with
  // an exact price_id (never invented). When unavailable, nothing is injected and no
  // financial tool is exposed → the AI cannot offer payments at all. Fail-safe.
  if (financialAvailable) {
    try {
      const catalogLine = await catalogPromptLine(input.tenantId)
      const requireApproval = normalizePaymentSettings((employee as { payment_collection_settings?: unknown }).payment_collection_settings).require_approval
      systemPrompt += `\n\n${financialIntentPrompt({ catalogLine, requireApproval })}`
    } catch { /* ignore — financial prompt is best-effort */ }
  }

  // Returning-customer recognition (Sprint 002) — TEXT CHANNELS ONLY, behind a
  // default-OFF flag. Injects a delimited, untrusted "background context" block only
  // for high-confidence returning customers. Fail-open: any error, low/medium
  // confidence, or flag off → injects nothing → behavior identical to today.
  if (!isVoice && process.env.CUSTOMER_RECOGNITION_TEXT_ENABLED === 'true') {
    try {
      const rec = await getRecognitionContext({
        tenantId: input.tenantId,
        contactId: contact?.id,
        contactName: contact?.name,
        excludeConversationId: conversationId,
      })
      const recBlock = recognitionPromptBlock(rec)
      if (recBlock) systemPrompt += `\n\n${recBlock}`
    } catch { /* ignore — recognition is best-effort */ }
  }

  // VOICE is UNCHANGED (single call, no tools — it books via the voice-server).
  // Non-booking text conversations are also unchanged. Only text channels that are
  // actively booking get the booking tools, so the AI actually persists the booking
  // via /book — exactly the logic voice uses.
  let aiResponse = ''
  if (!isVoice && (inBooking || financialIntent || catalogIntent)) {
    aiResponse = await runTextToolTurn(input.tenantId, systemPrompt, chatMessages, {
      leadToken: (tenant as { lead_intake_token?: string }).lead_intake_token || '',
      channel: input.channelType, // 'sms' | 'instagram' | 'facebook'
      customerPhoneFallback: input.channelType === 'sms' ? input.from : null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || '',
      conversationId,
      contactId: contact?.id ?? null,
    }, { includeBooking: inBooking, includeFinancial: financialAvailable, includeCatalog: catalogIntent })
  } else {
    const model = isVoice ? VOICE_MODEL : MODEL
    const response = await anthropic.messages.create({
      model,
      max_tokens: isVoice ? 120 : 500,
      system: systemPrompt,
      messages: chatMessages,
    })
    aiResponse = response.content[0].type === 'text' ? response.content[0].text : ''
    trackLlm(input.tenantId, model, response.usage, { resourceId: response.id, customerId: contact?.id ?? null }) // COGS + WL billing
  }

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

// Text-channel tool turn (SMS / Instagram / Facebook): runs the model with the requested
// tool sets — booking (check_availability / book_appointment) and/or the Financial Intent
// capability (send_payment_link) — and executes any tool calls against the SAME backend
// endpoints (voice uses the booking ones too). Booking tools hit /available + /book;
// financial tools hit the payment-link route (skill + approval + Stripe enforced there).
// Returns the final assistant text. Fully fail-safe — on any error it falls back to a plain
// reply so the pipeline never crashes.
async function runTextToolTurn(
  tenantId: string,
  systemPrompt: string,
  chatMessages: { role: 'user' | 'assistant'; content: string }[],
  ctx: BookingToolCtx,
  opts: { includeBooking: boolean; includeFinancial: boolean; includeCatalog?: boolean },
): Promise<string> {
  const plainReply = async (): Promise<string> => {
    try {
      const r = await anthropic.messages.create({ model: MODEL, max_tokens: 500, system: systemPrompt, messages: chatMessages })
      trackLlm(tenantId, MODEL, r.usage, { resourceId: r.id }) // COGS + WL billing
      return r.content[0]?.type === 'text' ? r.content[0].text : ''
    } catch { return '' }
  }

  const tools = [
    ...(opts.includeBooking ? BOOKING_TOOLS : []),
    ...(opts.includeFinancial ? FINANCIAL_TOOLS : []),
    ...(opts.includeCatalog ? CATALOG_TOOLS : []),
  ]
  // Booking/financial tools hit our backend (need appUrl); catalog reads the DB directly.
  const needsBackend = opts.includeBooking || opts.includeFinancial
  if (tools.length === 0 || (needsBackend && !ctx.appUrl && !opts.includeCatalog)) return plainReply()

  try {
    const messages: Anthropic.MessageParam[] = chatMessages.map((m) => ({ role: m.role, content: m.content }))
    let text = ''
    for (let i = 0; i < 4; i++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages,
        tools,
      })
      trackLlm(tenantId, MODEL, response.usage, { resourceId: response.id }) // COGS + WL billing

      const textBlocks = response.content.filter((c): c is Anthropic.TextBlock => c.type === 'text')
      if (textBlocks.length) text = textBlocks.map((b) => b.text).join(' ').trim()

      const toolUses = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break

      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        // Route each call to the right capability's executor.
        const out = isCatalogTool(tu.name)
          ? await executeCatalogTool(tu.name, tu.input as Record<string, unknown>, tenantId)
          : isFinancialTool(tu.name)
          ? await executeFinancialTool(tu.name, tu.input as Record<string, unknown>, ctx)
          : await executeBookingTool(tu.name, tu.input as Record<string, unknown>, ctx)
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
      }
      messages.push({ role: 'user', content: results })
    }
    return text || (await plainReply())
  } catch (err) {
    console.error('[pipeline] tool turn failed — falling back to plain reply:', err instanceof Error ? err.message : err)
    return plainReply()
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

  trackLlm(tenantId, MODEL, summary.usage, { resourceId: summary.id }) // COGS + WL billing
  const summaryText = summary.content[0].type === 'text' ? summary.content[0].text : ''

  await supabase
    .from('conversations')
    .update({ summary: summaryText })
    .eq('id', conversationId)
}
