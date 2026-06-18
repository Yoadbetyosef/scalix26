import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { provisionAgentPhoneNumber } from '@/lib/twilio/provision'
import { sendSMS } from '@/lib/twilio/client'
import { notifyAdminNewUser } from '@/lib/admin/notify'
import { maxEmployeesForPlan } from '@/lib/plans'

interface FAQ {
  q: string
  a: string
}

function buildSystemPrompt(data: {
  businessName: string
  ownerName: string
  businessType: string
  websiteUrl: string
  scrapedContent: string
  services: string
  pricing: string
  specialInstructions: string
  googleReviewsLink: string
  aiInstructions: string
  faqs: FAQ[]
}): string {
  const lines: string[] = [
    `You are a friendly AI assistant for ${data.businessName}, a ${data.businessType} business.`,
  ]

  if (data.ownerName) {
    lines.push(`The owner is ${data.ownerName}.`)
  }

  if (data.websiteUrl) {
    lines.push(`Business website: ${data.websiteUrl}`)
  }

  if (data.scrapedContent) {
    lines.push('', 'About this business (from website):', data.scrapedContent)
  } else {
    if (data.services) lines.push('', `Services offered:\n${data.services}`)
    if (data.pricing) lines.push('', `Pricing:\n${data.pricing}`)
    if (data.specialInstructions) lines.push('', `Additional info:\n${data.specialInstructions}`)
  }

  if (data.aiInstructions) {
    lines.push('', `Special instructions:\n${data.aiInstructions}`)
  }

  const validFaqs = (data.faqs || []).filter(f => f.q?.trim() && f.a?.trim())
  if (validFaqs.length > 0) {
    lines.push('', 'Common questions and answers:')
    validFaqs.forEach(f => lines.push(`Q: ${f.q}`, `A: ${f.a}`, ''))
  }

  if (data.googleReviewsLink) {
    lines.push('', `After successfully helping a customer, invite them to leave a Google review: ${data.googleReviewsLink}`)
  }

  lines.push(
    '',
    'Guidelines:',
    '- Be warm, helpful, and represent the business professionally',
    '- If you cannot answer something, offer to have the owner call them back',
    '- Keep responses concise and friendly',
    '- Never quote exact prices unless they are listed above — offer a free estimate instead'
  )

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    businessName, ownerName, ownerPhone, businessType,
    websiteUrl, scrapedContent, services, pricing, specialInstructions,
    googleReviewsLink, greeting, tone, voice, aiInstructions, faqs,
  } = body

  const serviceSupabase = await createServiceClient()

  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('id, plan')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Idempotent first-agent bootstrap: if the tenant already has an agent, return it
  // and do NOT create/provision again — prevents a double-buy / orphaned number on
  // retry or double-submit (provisioning is also idempotent per agent).
  const { data: existingAgents } = await serviceSupabase
    .from('ai_employees').select('id').eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true }).limit(1)
  if (existingAgents && existingAgents.length > 0) {
    return NextResponse.json({ success: true, employeeId: existingAgents[0].id, existing: true })
  }

  // Plan gate BEFORE create/provision. The first agent passes (0 < trial limit of 1);
  // this also blocks creating/provisioning a second on a tenant already at its cap.
  const { count: agentCount } = await serviceSupabase
    .from('ai_employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
  if ((agentCount ?? 0) >= maxEmployeesForPlan(tenant.plan)) {
    return NextResponse.json({ error: 'plan_limit' }, { status: 403 })
  }

  // Update tenant name for billing/account purposes (+ store the owner's
  // business phone so the post-onboarding checklist can text them).
  await serviceSupabase
    .from('tenants')
    .update({ business_name: businessName, industry: businessType, phone: ownerPhone || null })
    .eq('id', tenant.id)

  const systemPrompt = buildSystemPrompt({
    businessName, ownerName, businessType, websiteUrl, scrapedContent,
    services, pricing, specialInstructions, googleReviewsLink, aiInstructions, faqs,
  })

  const personalityScore = tone === 'casual' ? 90 : tone === 'friendly' ? 75 : 35

  const employeeName = ownerName
    ? `${ownerName}'s AI Assistant`
    : `${businessName} AI`

  const { data: employee, error } = await serviceSupabase
    .from('ai_employees')
    .insert({
      tenant_id: tenant.id,
      name: employeeName,
      greeting: greeting || `Hi! Thanks for contacting ${businessName}. How can I help you today?`,
      personality: tone === 'professional' ? 'professional' : 'friendly',
      personality_score: personalityScore,
      // Voice chosen in onboarding (real Aura headshot voice); default to Asteria.
      voice: typeof voice === 'string' && voice.startsWith('aura') ? voice : 'aura-2-asteria-en',
      avatar_url: `/avatars/${(typeof voice === 'string' ? voice.split('-')[2] : 'asteria') || 'asteria'}.png`,
      system_prompt: systemPrompt,
      status: 'active',
      // Business identity stored per-agent
      business_name: businessName,
      industry: businessType,
      website: websiteUrl || null,
      forward_to_phone: ownerPhone || null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[onboarding/complete]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Provision a dedicated phone number for this agent
  let phoneNumber: string | null = null
  try {
    phoneNumber = await provisionAgentPhoneNumber(tenant.id, employee.id)
  } catch (err) {
    console.error('[onboarding] Phone provisioning failed:', err)
  }

  // WOW moment: text the owner from their brand-new AI number so they can
  // reply and test it immediately. Skip silently if we have no phone/number.
  if (ownerPhone && phoneNumber) {
    try {
      await sendSMS(
        ownerPhone,
        `🎉 Your AI is live! This is ${employeeName} from ${businessName}. Reply to this message to test me out — I'm ready to book jobs 24/7.`,
        phoneNumber,
      )
    } catch (err) {
      console.error('[onboarding] Welcome SMS failed:', err instanceof Error ? err.message : err)
    }
  }

  // Notify admin of new signup
  notifyAdminNewUser({
    name: businessName,
    email: user.email || '',
    phone: ownerPhone || '',
    plan: 'trial',
  }).catch(console.error)

  return NextResponse.json({ success: true, employeeId: employee.id, phoneNumber })
}
