import { AppShell } from '@/components/app/app-shell'
import { createClient } from '@/lib/supabase/server'
import { getTenantEnabledModules } from '@/lib/tenant'
import { notFound, redirect } from 'next/navigation'

// Orders route guard. Only tenants with the `orders` module enabled reach it; everyone else gets a 404 (the
// module is not even revealed). Self-contained — no navigation entry appears without the module either.
export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const modules = await getTenantEnabledModules()
  if (!modules.includes('orders')) notFound()

  return <AppShell>{children}</AppShell>
}
