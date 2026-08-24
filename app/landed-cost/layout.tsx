import { AppShell } from '@/components/app/app-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// Supplier bills is a row in the rail, so it has to keep the rail. It had no layout of its own and
// rendered outside AppShell entirely — clicking it from the sidebar lost the sidebar.
//
// The same guard app/dashboard/layout.tsx uses, for the same reason: this is the business
// application, and a signed-out visitor goes to login rather than to a bare page.
export default async function LandedCostLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return <AppShell>{children}</AppShell>
}
