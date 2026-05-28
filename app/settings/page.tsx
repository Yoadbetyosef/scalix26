import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsClient } from '@/components/settings/settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user.id).single()
  if (!tenant) redirect('/auth/signup')

  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .eq('tenant_id', tenant.id)

  return <SettingsClient tenant={tenant} channels={channels || []} />
}
