import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { enabledPartnerModules } from '@/lib/partner/modules'
import { PartnerSidebar } from '@/components/partner/partner-sidebar'
import { PartnerModuleGuard } from '@/components/partner/module-guard'
import { PartnerNotifications } from '@/components/partner/partner-notifications'
import { CompanyNav } from '@/components/partner/company-nav'
import { resolveBrandForPartner, strongColor } from '@/lib/partner/brand'
import { BrandProvider } from '@/components/brand/brand-provider'
import { getActiveWorkspace } from '@/lib/workspace'

// Guards the authenticated partner portal. A signed-in user who is not yet a partner is sent to
// the partner signup; a signed-out user is already bounced to /partner/login by middleware.
export default async function PartnerAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPartnerContext()
  if (!ctx) {
    // A White Label CLIENT (owns a business under a partner) must never see any partner surface —
    // not even the partner signup. Send them to their own business. Normal Scalix customers who aren't
    // partners can still reach the partner signup (they may want to become one).
    const ws = await getActiveWorkspace()
    if (ws.whiteLabelPartnerId) redirect('/dashboard')
    redirect('/partner/signup')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const enabledModules = enabledPartnerModules({ enabled_modules: ctx.enabledModulesRaw })
  // Billing mode decides the whole product surface. One cheap lookup.
  const { data: p } = await createAdminClient().from('partners').select('billing_mode').eq('id', ctx.partnerId).maybeSingle()
  const billingMode = p?.billing_mode || 'revenue_share'
  const isCompany = billingMode === 'white_label' || billingMode === 'reseller'

  // ── The White Label "company" operating system ──────────────────────────────
  // A premium, fully self-branded SaaS console. The whole surface is themed in the OWNER's brand
  // (their logo, name, and accent color) — the console must feel like software they built. Falls back
  // to the neutral company accent when no brand is configured yet (never a Scalix brand here).
  if (isCompany) {
    const brand = await resolveBrandForPartner(ctx.partnerId)
    const companyName = brand?.name || ctx.companyName || 'Your Company'
    const ownerName = (user?.user_metadata?.full_name as string | undefined) || (user?.email ? user.email.split('@')[0] : null)
    const accent = brand?.primaryColor
    const style = accent
      ? ({ '--color-accent': accent, '--color-accent-strong': strongColor(accent) || accent } as CSSProperties)
      : undefined
    return (
      <BrandProvider brand={brand ?? { name: companyName, logoUrl: null, faviconUrl: null, primaryColor: null, secondaryColor: null, supportEmail: null, supportPhone: null, website: null, emailFooter: null, loginBackgroundUrl: null, poweredByScalix: false, isPartnerBrand: !!brand }}>
        <div className="min-h-screen bg-canvas" style={style}>
          <CompanyNav companyName={companyName} logoUrl={brand?.logoUrl ?? null} ownerName={ownerName} />
          <div className="md:pl-16 xl:pl-60">
            <main className="mx-auto max-w-[1240px] px-4 pb-24 pt-6 sm:px-6 md:pb-12">{children}</main>
          </div>
        </div>
      </BrandProvider>
    )
  }

  // ── Affiliate / growth partner portal (unchanged) ───────────────────────────
  const { data: tenant } = user ? await supabase.from('tenants').select('id').eq('user_id', user.id).maybeSingle() : { data: null }
  return (
    <div className="min-h-screen bg-canvas">
      <PartnerModuleGuard enabledModules={enabledModules} billingMode={billingMode} />
      <PartnerSidebar companyName={ctx.companyName} slug={ctx.slug} partnerType={ctx.partnerType} billingMode={billingMode} hasTenant={!!tenant} enabledModules={enabledModules} />
      <div className="md:pl-16 xl:pl-56">
        <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6 md:pb-10">{children}</main>
      </div>
      <PartnerNotifications />
    </div>
  )
}
