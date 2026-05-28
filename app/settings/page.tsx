import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsClient } from '@/components/settings/settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase.from('tenants').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .eq('tenant_id', tenant.id)

  return <SettingsClient tenant={tenant} channels={channels || []} />
}
