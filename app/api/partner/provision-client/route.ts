import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { insertTenantWithUniqueSlug } from '@/lib/tenants'
import { seedDefaultSkills } from '@/lib/skills'
import { ALL_MODULES } from '@/lib/modules'
import { resolvePartnerEconomics, effectiveItemPricing } from '@/lib/partner/economics-resolve'
import { getPartnerTwilio } from '@/lib/partner/integrations'
import { provisionAgentPhoneNumber } from '@/lib/twilio/provision'

// Provision a client workspace for a White Label / Reseller partner. REUSES the existing tenant +
// AI-employee + skills bootstrap (no duplicate provisioning). Client tenants have user_id = NULL and
// are linked to the partner via white_label_partner_id + partner_clients — invisible to the business
// plane, managed entirely from the partner portal. Numbers route through the partner's own Twilio.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('billing_mode, wl_retail_defaults').eq('id', ctx.partnerId).maybeSingle()
  if (partner?.billing_mode !== 'white_label' && partner?.billing_mode !== 'reseller') {
    return NextResponse.json({ error: 'Client provisioning is for white-label / reseller partners only.' }, { status: 403 })
  }

  const b = await req.json().catch(() => ({}))
  const businessName = (b.business_name || '').trim()
  if (!businessName) return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
  const planCode: string | null = b.plan_code || null
  const channels = b.channels || {}

  // Resolve pricing from the assigned price book (real data — no hardcoded numbers).
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  const item = planCode ? econ.priceBook?.items.find((i) => i.plan_code === planCode) : undefined
  const p = item ? effectiveItemPricing(item, { customWholesaleDiscountPct: econ.customWholesaleDiscountPct, retailMarkupPct: econ.retailMarkupPct }) : null
  const retailDefaults = (partner?.wl_retail_defaults || {}) as Record<string, number>
  const wholesaleCents = p?.wholesale_cents ?? null
  const retailCents = b.retail_price_cents ?? (planCode && retailDefaults[planCode]) ?? p?.retail_cents ?? null

  // 1) Workspace (tenant) — reuse the slug-safe creator; user_id NULL, linked to the partner.
  // A White Label client is sold the FULL platform, so provision with the complete module set (global
  // feature flags still apply). This makes every product route available when the partner operates it.
  const { data: tenant, error: tErr } = await insertTenantWithUniqueSlug(db, {
    business_name: businessName, white_label_partner_id: ctx.partnerId,
    phone: b.owner_phone || null, email: b.owner_email || null, website: b.website || null,
    plan: planCode || 'trial', enabled_modules: ALL_MODULES,
  })
  if (tErr || !tenant) return NextResponse.json({ error: 'Could not create workspace' }, { status: 400 })

  // 2) AI employee (draft) — reuse the same table + skills bootstrap the business onboarding uses.
  const employeeName = b.owner_name ? `${b.owner_name}'s AI Assistant` : `${businessName} AI`
  const systemPrompt = `You are a friendly AI assistant for ${businessName}. Be warm, helpful, and represent the business professionally. Offer to have the owner follow up when you can't answer. Keep responses concise.`
  const { data: employee, error: eErr } = await db.from('ai_employees').insert({
    tenant_id: tenant.id, name: employeeName,
    greeting: `Hi! Thanks for contacting ${businessName}. How can I help you today?`,
    personality: 'friendly', personality_score: 75, voice: 'aura-2-asteria-en', avatar_url: '/avatars/asteria.png',
    system_prompt: systemPrompt, status: 'active', business_name: businessName, website: b.website || null,
    forward_to_phone: b.owner_phone || null, setup_complete: false,
  }).select('id').single()
  if (eErr || !employee) return NextResponse.json({ error: 'Workspace created but AI employee failed', tenant_id: tenant.id }, { status: 500 })
  await seedDefaultSkills(db, tenant.id, employee.id).catch(() => {})

  // 3) Client account row (economics overlay).
  await db.from('partner_clients').insert({
    partner_id: ctx.partnerId, tenant_id: tenant.id, business_name: businessName, plan_code: planCode,
    retail_price_cents: retailCents, wholesale_price_cents: wholesaleCents, status: 'active',
  })

  // 4) Optional: provision a phone number via the PARTNER's Twilio (they pay). Non-blocking.
  let phoneNumber: string | null = null
  if (channels.phone) {
    const tw = await getPartnerTwilio(ctx.partnerId)
    if (tw) {
      try { phoneNumber = await provisionAgentPhoneNumber(tenant.id, employee.id, { accountSid: tw.accountSid, authToken: tw.authToken, messagingServiceSid: tw.messagingServiceSid }) }
      catch (err) { console.error('[provision-client] number provisioning failed:', err instanceof Error ? err.message : err) }
    }
  }

  return NextResponse.json({
    success: true, tenant_id: tenant.id, employee_id: employee.id, business_name: businessName,
    phone_number: phoneNumber, number_pending: !!channels.phone && !phoneNumber,
  })
}
