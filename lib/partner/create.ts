import { createAdminClient } from '@/lib/supabase/server'
import type { PartnerType } from './rbac'
import { logPartnerAction } from './audit'

export interface CreatePartnerInput {
  userId: string
  contactEmail: string
  companyName?: string | null
  contactPhone?: string | null
  partnerType?: PartnerType
  originTenantId?: string | null   // set when an existing customer becomes a partner (viral loop)
}

export interface CreatePartnerResult {
  partnerId?: string
  slug?: string
  error?: string
}

/**
 * Create a partner org + its owner membership, and attach the global default commission plan.
 * Service-role only (partners/partner_members are RLS-locked). Enforces one active partner
 * membership per user via the DB partial unique index — a user who already owns/belongs to a
 * partner org is returned that org rather than erroring.
 */
export async function createPartner(input: CreatePartnerInput): Promise<CreatePartnerResult> {
  const db = createAdminClient()

  // Already a partner member? Return the existing org (idempotent "become a partner").
  const { data: existing } = await db
    .from('partner_members').select('partner_id, partners(slug)')
    .eq('user_id', input.userId).eq('status', 'active').limit(1).maybeSingle()
  if (existing?.partner_id) {
    const slug = (existing.partners as unknown as { slug?: string } | null)?.slug
    return { partnerId: existing.partner_id, slug }
  }

  const { data: defaultPlan } = await db
    .from('commission_plans').select('id').is('partner_id', null).eq('active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()

  const { data: partner, error: pErr } = await db
    .from('partners')
    .insert({
      partner_type: input.partnerType || 'affiliate',
      company_name: input.companyName || null,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone || null,
      status: 'active',
      default_commission_plan_id: defaultPlan?.id || null,
      origin_tenant_id: input.originTenantId || null,
    })
    .select('id, slug').single()
  if (pErr || !partner) return { error: pErr?.message || 'Could not create partner.' }

  const { error: mErr } = await db.from('partner_members').insert({
    partner_id: partner.id, user_id: input.userId, role: 'owner', status: 'active',
  })
  if (mErr) {
    // Roll back the orphan partner so a retry is clean.
    await db.from('partners').delete().eq('id', partner.id)
    return { error: mErr.message }
  }

  await logPartnerAction(partner.id, input.contactEmail, {
    action: 'partner.created', targetType: 'partner', targetId: partner.id,
    after: { partner_type: input.partnerType || 'affiliate', origin_tenant_id: input.originTenantId || null },
  })
  return { partnerId: partner.id, slug: partner.slug }
}
