import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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
    googleReviewsLink, greeting, tone, aiInstructions, faqs,
  } = body

  const serviceSupabase = await createServiceClient()

  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  await serviceSupabase
    .from('tenants')
    .update({ business_name: businessName, industry: businessType })
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
      voice: 'professional_female',
      system_prompt: systemPrompt,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[onboarding/complete]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Link any unlinked channels to this employee
  await serviceSupabase
    .from('channels')
    .update({ ai_employee_id: employee.id })
    .eq('tenant_id', tenant.id)
    .is('ai_employee_id', null)

  return NextResponse.json({ success: true, employeeId: employee.id })
}
