import { AppShell } from '@/components/app/app-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// Guards the business application. Signed-out → login. We do NOT bounce partners away from /dashboard:
// business ownership wins (see lib/routing.ts), and partner access is explicit via /partner. A partner
// who explicitly opens /dashboard sees the business app; the default landing is decided by the root
// resolver, not here. Operator mode (operating a client) renders normally inside AppShell.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return <AppShell>{children}</AppShell>
}
