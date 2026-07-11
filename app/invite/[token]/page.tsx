import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { getInviteByToken } from '@/lib/partner/invites'
import { resolveBrandForPartner, strongColor } from '@/lib/partner/brand'
import { InviteAcceptForm } from '@/components/invite/invite-accept-form'

export const dynamic = 'force-dynamic'

// Override the root layout's (host = Scalix) metadata so the browser tab + favicon are the partner's
// brand — the invited customer must never see "Scalix" anywhere, including the tab title.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const found = await getInviteByToken(token)
  const brand = found ? await resolveBrandForPartner(found.invite.partner_id) : null
  const name = brand?.name || 'Your AI Platform'
  return { title: `Welcome to ${name}`, ...(brand?.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}) }
}

// PUBLIC, fully branded. The invited owner lands here from the email. Everything resolves from the
// White Label company (logo, name, colors, support) — it must feel like the partner's own product.
export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await getInviteByToken(token)
  const brand = found ? await resolveBrandForPartner(found.invite.partner_id) : null
  const accent = (brand && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor || '')) ? brand.primaryColor! : '#5B6CF0'
  const company = brand?.name || 'Your AI Platform'
  const style = { '--color-accent': accent, '--color-accent-strong': strongColor(accent) || accent } as CSSProperties

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f8] p-4" style={style}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          {brand?.logoUrl
            ? <img src={brand.logoUrl} alt={company} className="h-8 w-auto max-w-[180px] object-contain" />
            : <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[16px] font-semibold text-white" style={{ background: accent }}>{company.charAt(0).toUpperCase()}</span>}
          <span className="text-[17px] font-semibold text-ink">{company}</span>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-e2">{children}</div>
        {brand?.poweredByScalix && <p className="mt-4 text-center text-[11px] text-muted">Powered by Scalix</p>}
      </div>
    </div>
  )

  // Invalid / used / revoked / expired — clean branded message, no Scalix.
  if (!found || ['accepted', 'revoked', 'expired'].includes(found.invite.status)) {
    const msg = !found ? 'This invitation link is not valid.'
      : found.invite.status === 'accepted' ? 'This invitation has already been used. You can sign in with your email and password.'
      : found.invite.status === 'revoked' ? 'This invitation has been revoked. Please contact your provider for a new one.'
      : 'This invitation has expired. Please ask for a new invitation.'
    return <Shell><h1 className="text-xl font-semibold text-ink">Invitation unavailable</h1><p className="mt-2 text-sm leading-relaxed text-subtle">{msg}</p>
      <a href="/auth/login" className="mt-5 inline-block text-sm font-medium" style={{ color: accent }}>Go to sign in →</a></Shell>
  }

  // Best-effort: mark the invite opened → pending (shows the owner "customer opened the invite").
  if (found.invite.status === 'sent' || found.invite.status === 'draft') {
    await createAdminClient().from('business_invites').update({ status: 'pending', opened_at: new Date().toISOString() }).eq('id', found.invite.id).then(undefined, () => {})
  }

  const businessName = found.tenant?.business_name || 'your business'
  return (
    <Shell>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">Your AI platform is ready</h1>
      <p className="mt-2 text-sm leading-relaxed text-subtle">
        Welcome to <strong className="text-ink">{company}</strong>. Set a password to sign in and manage <strong className="text-ink">{businessName}</strong> — your AI employee is on duty 24/7.
      </p>
      <div className="mt-6">
        <InviteAcceptForm token={token} email={found.invite.email} ctaColor={accent} />
      </div>
    </Shell>
  )
}
