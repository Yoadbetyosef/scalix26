import { AppShell } from '@/components/app/app-shell'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getActiveWorkspace } from '@/lib/workspace'
import { getPartnerContext } from '@/lib/partner/rbac'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // A White Label / reseller partner's home is their COMPANY console (/partner), never a business
  // dashboard. If such a partner reaches /dashboard in OWNER mode (login landing, or a cleared
  // active_ws), send them to the company plane. Gated to owner mode ONLY, so operating a client
  // workspace (mode === 'operator') is never affected — and this lives on the dashboard route alone,
  // so navigating to Inbox/Contacts/AI Employees inside a client is untouched. (Normal business owners
  // and revenue-share affiliates are unaffected — only white_label/reseller.)
  const ws = await getActiveWorkspace()
  if (ws.mode !== 'operator') {
    const ctx = await getPartnerContext()
    if (ctx) {
      const { data: p } = await createAdminClient().from('partners').select('billing_mode').eq('id', ctx.partnerId).maybeSingle()
      if (p?.billing_mode === 'white_label' || p?.billing_mode === 'reseller') redirect('/partner')
    }
  }

  return <AppShell>{children}</AppShell>
}
