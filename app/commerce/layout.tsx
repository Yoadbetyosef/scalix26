import { AppShell } from '@/components/app/app-shell'
import { ModuleDisabled } from '@/components/app/module-disabled'
import { createClient } from '@/lib/supabase/server'
import { getTenantEnabledModules } from '@/lib/tenant'
import { redirect } from 'next/navigation'

// Core Commerce UI shell. Gated by the `commerce` module, which is off by default (opt-in) — a tenant only
// reaches these screens once an admin explicitly enables Commerce. Additive: never touches /catalog or /orders.
export default async function CommerceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const modules = await getTenantEnabledModules()
  if (!modules.includes('commerce')) return <AppShell><ModuleDisabled name="Commerce" /></AppShell>

  return <AppShell>{children}</AppShell>
}
