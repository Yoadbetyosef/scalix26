import { AppShell } from '@/components/app/app-shell'
import { ModuleDisabled } from '@/components/app/module-disabled'
import { createClient } from '@/lib/supabase/server'
import { getTenantEnabledModules } from '@/lib/tenant'
import { redirect } from 'next/navigation'

export default async function AppointmentsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const modules = await getTenantEnabledModules()
  if (!modules.includes('scheduling')) return <AppShell><ModuleDisabled name="Appointments" /></AppShell>

  return <AppShell>{children}</AppShell>
}
