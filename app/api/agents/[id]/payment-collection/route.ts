import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { normalizePaymentSettings, isPaymentCollectionActive, type PaymentCollectionSettings } from '@/lib/stripe/payment-collection'

// Owner-facing Payment Collection settings for one agent. GET returns current settings +
// whether the skill is active; POST saves settings. Ownership is enforced by tenant.
async function ownedAgent(agentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' as const, status: 401 as const }
  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id, payment_collection_settings').eq('id', agentId).single()
  if (!agent) return { error: 'Not found' as const, status: 404 as const }
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || agent.tenant_id !== activeTenantId) return { error: 'Forbidden' as const, status: 403 as const }
  return { admin, agent }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await ownedAgent(id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({
    settings: normalizePaymentSettings(r.agent.payment_collection_settings),
    active: await isPaymentCollectionActive(r.admin, id),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await ownedAgent(id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const body = await req.json().catch(() => ({}))
  const settings: PaymentCollectionSettings = normalizePaymentSettings(body?.settings ?? body)
  const { error } = await r.admin.from('ai_employees').update({ payment_collection_settings: settings }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, settings })
}
