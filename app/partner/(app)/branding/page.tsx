import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader, Panel } from '@/components/partner/ui'
import { Palette, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

const FEATURES = ['Company name & logo', 'Primary & accent colors', 'Support email & phone', 'Email footer & “Powered by Scalix” toggle', 'Custom domain (coming later)', 'Live brand preview']

export default async function BrandingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  return (
    <div>
      <PageHeader title="Branding" subtitle="Run Scalix26 under your own brand." />
      <Panel title={<span className="inline-flex items-center gap-2"><Palette className="h-4 w-4 text-accent-strong" /> White-label branding</span>}>
        <div className="rounded-2xl border border-dashed border-hairline-strong bg-canvas p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Sparkles className="h-6 w-6" /></div>
          <h3 className="text-lg font-semibold text-ink">Your brand, front and center</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-subtle">Full white-label branding is being finalized for your account. Soon you&apos;ll control every touchpoint your clients see:</p>
          <ul className="mx-auto mt-4 grid max-w-md gap-2 text-left sm:grid-cols-2">
            {FEATURES.map((f) => <li key={f} className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink shadow-e1"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{f}</li>)}
          </ul>
          <p className="mt-5 text-xs text-muted">Until then, your branding is applied as part of your Scalix26 agreement. Contact <a href="mailto:partners@scalix26.com" className="font-medium text-accent-strong hover:underline">partners@scalix26.com</a> to set it up.</p>
        </div>
      </Panel>
    </div>
  )
}
