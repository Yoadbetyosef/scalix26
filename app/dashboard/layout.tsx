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

  // NO BOTTOM PADDING ON THE PHONE. AppShell gives <main> 72px so a list's last row cannot hide
  // under the swipe handle. The dashboard has no list — the hero is exactly one viewport tall and
  // the handle floats over it, the same way it floats over /v2 — so that padding is 72px of page
  // to scroll for nothing, on the one screen whose whole point is that it has no fold.
  return <AppShell mainClassName="max-md:pb-0">{children}</AppShell>
}
