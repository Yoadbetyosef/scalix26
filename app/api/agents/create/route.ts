import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { provisionAgentPhoneNumber } from '@/lib/twilio/provision'
import { maxEmployeesForPlan, planLimitMessage } from '@/lib/plans'
import { resolveTimezone } from '@/lib/timezone'
import { seedDefaultSkills } from '@/lib/skills'

// Create an additional AI employee + provision its dedicated number. The plan
// limit is checked BEFORE any provisioning — we never buy a Twilio number and then
// reject the create. Order: count vs PLANS[plan].maxEmployees → create → provision.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { name, voice, greeting, personality_score, business_name, industry, website, system_prompt, timezone: browserTz } = body
  const resolvedTimezone = resolveTimezone({ browserTz })

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants').select('id, plan').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // ── IDEMPOTENT DRAFT REUSE ─────────────────────────────────────────────────
  // Reuse an existing unfinished draft (setup_complete=false) instead of creating +
  // provisioning a new agent, so a refresh / re-navigation never spawns a second
  // agent or buys a second number. (Tolerant if the column isn't migrated yet.)
  const { data: draft } = await service
    .from('ai_employees').select('id').eq('tenant_id', tenant.id).eq('setup_complete', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (draft?.id) {
    let phoneNumber: string | null = null
    try { phoneNumber = await provisionAgentPhoneNumber(tenant.id, draft.id) } catch { /* idempotent; non-fatal */ }
    console.log('[agents/create] reusing unfinished draft', draft.id)
    return NextResponse.json({ success: true, employeeId: draft.id, reused: true, phoneNumber })
  }

  // ── PLAN GATE (before create, before provision) ────────────────────────────
  const { count } = await service
    .from('ai_employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
  const current = count ?? 0
  const max = maxEmployeesForPlan(tenant.plan)
  if (current >= max) {
    console.log(`[agents/create] plan limit: tenant ${tenant.id} plan ${tenant.plan} has ${current}/${max}`)
    return NextResponse.json({ error: planLimitMessage(tenant.plan), code: 'plan_limit' }, { status: 403 })
  }

  // Create the agent (only after passing the gate).
  const safeVoice = typeof voice === 'string' && voice.startsWith('aura') ? voice : 'aura-2-asteria-en'
  const { data: employee, error } = await service.from('ai_employees').insert({
    tenant_id: tenant.id,
    name: name || 'Alex',
    voice: safeVoice,
    avatar_url: `/avatars/${safeVoice.split('-')[2] || 'asteria'}.png`,
    greeting: greeting || `Hi! Thanks for reaching out. How can I help you today?`,
    personality_score: typeof personality_score === 'number' ? personality_score : 70,
    status: 'active',
    business_name: business_name || null,
    industry: industry || null,
    website: website || null,
    system_prompt: system_prompt || null,
    timezone: resolvedTimezone,
  }).select('id').single()
  if (error || !employee) {
    console.error('[agents/create] insert failed:', error?.message)
    return NextResponse.json({ error: "Couldn't create the employee — please try again." }, { status: 400 })
  }

  // Mark as an unfinished draft so a refresh reuses it (best-effort; tolerant of an
  // unmigrated column). Cleared by "Finish setup".
  await service.from('ai_employees').update({ setup_complete: false }).eq('id', employee.id)

  // Seed the default skills (same set as the first agent) so every agent is identical.
  await seedDefaultSkills(service, tenant.id, employee.id)

  // Provision a dedicated number AFTER the gate + create. Idempotent; non-fatal.
  let phoneNumber: string | null = null
  try {
    phoneNumber = await provisionAgentPhoneNumber(tenant.id, employee.id)
  } catch (err) {
    console.error('[agents/create] provision failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ success: true, employeeId: employee.id, phoneNumber })
}
