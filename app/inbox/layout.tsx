import { AppShell } from '@/components/app/app-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return <AppShell>{children}</AppShell>
}
