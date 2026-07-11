import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getActiveWorkspace } from '@/lib/workspace'
import { SettingsClient } from '@/components/settings/settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active workspace (owner tenant, or the client tenant a WL partner is operating). Admin client +
  // explicit tenant_id — the RLS cookie client would resolve to the operator's own tenant.
  const ws = await getActiveWorkspace()
  if (!ws.tenantId) redirect('/auth/signup')
  const db = createAdminClient()
  const { data: tenant } = await db.from('tenants').select('*').eq('id', ws.tenantId).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: channels } = await db.from('channels').select('*').eq('tenant_id', tenant.id)

  // In operator mode the Scalix billing/subscription section is hidden — a White Label client's plan is
  // governed by the partner, never Scalix Stripe. (Owner mode is unchanged for normal customers.)
  return <SettingsClient tenant={tenant} channels={channels || []} hideBilling={ws.mode === 'operator'} />
}
