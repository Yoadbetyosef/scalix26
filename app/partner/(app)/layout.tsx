import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createClient } from '@/lib/supabase/server'
import { PartnerSidebar } from '@/components/partner/partner-sidebar'
import { PartnerNotifications } from '@/components/partner/partner-notifications'

// Guards the authenticated partner portal. A signed-in user who is not yet a partner is sent to
// the partner signup; a signed-out user is already bounced to /partner/login by middleware.
export default async function PartnerAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partner/signup')

  // For the plane switcher: does this user also own a business (tenant)?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = user ? await supabase.from('tenants').select('id').eq('user_id', user.id).maybeSingle() : { data: null }

  return (
    <div className="min-h-screen bg-canvas">
      <PartnerSidebar companyName={ctx.companyName} slug={ctx.slug} partnerType={ctx.partnerType} hasTenant={!!tenant} />
      <div className="md:pl-16 xl:pl-56">
        <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6 md:pb-10">{children}</main>
      </div>
      <PartnerNotifications />
    </div>
  )
}
