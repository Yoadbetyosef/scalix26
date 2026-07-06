import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { planPrice } from '@/lib/admin/pricing'
import { enabledModulesOf } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'

// GET /api/admin/businesses/[id] — full management view for one business, all real data.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const db = createAdminClient() // service-role: bypass RLS to read any business
  const { data: t, error } = await db.from('tenants').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const monthISO = monthStart.toISOString()
  const mcount = (channel: string) =>
    db.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', id).eq('channel', channel).gte('timestamp', monthISO)

  const [authRes, agentsRes, channelsRes, kbRes, convosRes, msgTotalRes, sms, whatsapp, instagram, facebook, email, notesRes, auditRes] =
    await Promise.all([
      db.auth.admin.getUserById(t.user_id),
      db.from('ai_employees').select('id, name, voice, status, system_prompt').eq('tenant_id', id),
      db.from('channels').select('type, status, twilio_number, meta_page_id').eq('tenant_id', id),
      db.from('knowledge_base').select('*', { count: 'exact', head: true }).eq('tenant_id', id),
      db.from('conversations').select('channel, duration_seconds').eq('tenant_id', id).gte('created_at', monthISO),
      db.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', id).gte('timestamp', monthISO),
      mcount('sms'), mcount('whatsapp'), mcount('instagram'), mcount('facebook'), mcount('email'),
      db.from('admin_notes').select('id, admin_email, body, created_at').eq('tenant_id', id).order('created_at', { ascending: false }),
      db.from('admin_audit_log').select('id, admin_email, action, before, after, created_at').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    ])

  const authUser = authRes.data?.user
  const channels = channelsRes.data || []
  const convos = convosRes.data || []
  const calls = convos.filter((c) => c.channel === 'voice').length
  const minutes = Math.round(convos.reduce((s, c) => s + (c.duration_seconds || 0), 0) / 60)

  const hasChannel = (types: string[], needMeta?: boolean) =>
    channels.some((c) => types.includes(c.type) && c.status === 'connected' && (!needMeta || c.meta_page_id))

  return NextResponse.json({
    business: {
      id: t.id,
      general: {
        business_name: t.business_name, industry: t.industry, website: t.website,
        phone: t.phone, address: [t.address, t.city, t.state, t.zip].filter(Boolean).join(', ') || null,
        created_at: t.created_at, timezone: t.timezone,
      },
      owner: {
        name: (authUser?.user_metadata?.name as string) || (authUser?.user_metadata?.full_name as string) || null,
        email: authUser?.email || t.email || null,
        last_login: authUser?.last_sign_in_at || null,
        joined: authUser?.created_at || t.created_at,
      },
      subscription: {
        plan: t.plan, revenue: planPrice(t.plan),
        stripe_customer_id: t.stripe_customer_id || null,
        stripe_subscription_id: t.stripe_subscription_id || null,
        trial_ends_at: t.trial_ends_at || null,
        renewal_date: null,   // Not tracked yet (needs Stripe subscription sync)
        payment_status: null, // Not tracked yet
      },
      usage: {
        calls, minutes,
        messages: msgTotalRes.count ?? 0,
        sms: sms.count ?? 0, whatsapp: whatsapp.count ?? 0,
        facebook: facebook.count ?? 0, instagram: instagram.count ?? 0, emails: email.count ?? 0,
        period: 'this_month',
      },
      ai: {
        agents: (agentsRes.data || []).map((a) => ({
          id: a.id, name: a.name, voice: a.voice, status: a.status,
          prompt_excerpt: a.system_prompt ? String(a.system_prompt).slice(0, 240) : null,
        })),
        knowledge_base_items: kbRes.count ?? 0,
        memory_pct: null, // Not tracked yet
      },
      connected: {
        twilio: hasChannel(['sms', 'voice', 'whatsapp']) || channels.some((c) => !!c.twilio_number),
        facebook: hasChannel(['facebook'], true),
        instagram: hasChannel(['instagram'], true),
        stripe: !!t.stripe_customer_id,
        google: null,     // Not tracked yet
        microsoft: null,  // Not tracked yet
      },
      modules: enabledModulesOf(t),
      module_flags: await getModuleFlags(),
      tags: t.tags || [],
      suspended: !!t.suspended_at,
      suspended_at: t.suspended_at || null,
      notes: notesRes.data || [],
      audit: auditRes.data || [],
    },
  })
}
