import { PageHeader, StatCard, Panel, money } from '@/components/partner/ui'
import { REFERENCE_PLAN_CENTS, type PartnerEconomics } from '@/lib/partner/economics-resolve'
import { Building2, Tag, Percent, Mail, Layers, Info, ShieldCheck } from 'lucide-react'
import { Flame } from 'lucide-react'

const SUPPORT_EMAIL = 'partners@scalix26.com'

// Partner dashboard for wholesale relationships (billing_mode = white_label | reseller). These
// partners resell at their own retail and keep the spread — they are NOT commission earners, so we
// never show "earn X% commission". The retail-billing engine isn't live yet, so amounts that depend
// on it show a clean "managed by agreement" state instead of invented numbers.
export function WholesalePartnerDashboard({ mode, companyName, econ, activeCustomers, streak }: {
  mode: 'white_label' | 'reseller'; companyName?: string | null; econ: PartnerEconomics; activeCustomers: number; streak?: number
}) {
  const isWL = mode === 'white_label'
  const label = isWL ? 'White Label' : 'Reseller'
  const hasWholesalePlan = econ.wholesaleDiscountPct != null || econ.model === 'wholesale' || econ.model === 'white_label'
  const discount = econ.wholesaleDiscountPct // % off retail the partner pays

  // Reference retail + resulting wholesale cost / margin, from the resolved plan's discount. Clearly
  // "estimated" — the actual retail is set by the partner.
  const retail = REFERENCE_PLAN_CENTS
  const wholesaleCost = discount != null ? Math.round(retail * (1 - discount / 100)) : null
  const marginPerAccount = discount != null ? retail - (wholesaleCost ?? 0) : null

  return (
    <div className="space-y-5 sm:space-y-6 sx-animate-in">
      <PageHeader
        title={`Welcome back${companyName ? `, ${companyName}` : ''}`}
        subtitle={isWL
          ? 'Your white-label business — your clients, your pricing, your margin.'
          : 'Your reseller business — your clients, your cost, your profit.'}
        action={streak && streak > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-600"><Flame className="h-4 w-4" /> {streak}-day streak</span> : undefined}
      />

      {/* Mode banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.06] to-transparent p-5 shadow-e1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-strong"><Building2 className="h-5 w-5" /></span>
        <div>
          <div className="text-[15px] font-semibold text-ink">{label} Partner</div>
          <p className="mt-0.5 max-w-xl text-sm text-subtle">
            {isWL
              ? 'You resell Scalix26 under your own brand at wholesale pricing and keep the spread. This is a wholesale agreement, not a commission plan.'
              : 'You buy Scalix26 at wholesale and resell to your clients at your own retail price, keeping the profit. This is a reseller agreement, not a commission plan.'}
          </p>
        </div>
      </div>

      {/* Headline metrics — real where we have it, honest "—" where the billing engine isn't live */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active client accounts" value={activeCustomers} hint="Customers under your account" />
        <StatCard label={isWL ? 'Wholesale rate' : 'Wholesale discount'} value={discount != null ? `${discount}% off` : '—'} hint={discount != null ? 'Off retail, per your plan' : 'Set by your agreement'} />
        <StatCard label={isWL ? 'Monthly resale revenue' : 'Monthly profit'} value="—" hint="Managed by your agreement" />
        <StatCard label={isWL ? 'Platform cost / owed' : 'Balance due'} value="—" hint="Managed by your agreement" />
      </div>

      {/* Pricing / agreement panel */}
      <Panel title={<span className="inline-flex items-center gap-2"><Tag className="h-4 w-4 text-accent-strong" /> {isWL ? 'Wholesale & partner pricing' : 'Reseller pricing'}</span>}>
        {hasWholesalePlan && discount != null ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PriceCell icon={Tag} label="Reference retail" value={`${money(retail)}/mo`} note="Est. — you set retail" />
              <PriceCell icon={Layers} label={isWL ? 'Your wholesale cost' : 'Your cost'} value={wholesaleCost != null ? `${money(wholesaleCost)}/mo` : '—'} note="Per account" accent />
              <PriceCell icon={Percent} label={isWL ? 'Estimated margin' : 'Estimated profit'} value={marginPerAccount != null ? `${money(marginPerAccount)}/mo` : '—'} note="Per account, at reference retail" />
              <PriceCell icon={Building2} label="Est. monthly margin" value={marginPerAccount != null ? `${money(marginPerAccount * activeCustomers)}/mo` : '—'} note={`Across ${activeCustomers} account${activeCustomers === 1 ? '' : 's'}`} />
            </div>
            {(econ.platformFeeCents != null || econ.setupFeeCents != null) && (
              <div className="flex flex-wrap gap-4 rounded-xl border border-hairline bg-canvas p-3 text-sm text-subtle">
                {econ.platformFeeCents != null && <span>Platform fee: <span className="font-medium text-ink">{money(econ.platformFeeCents)}/mo</span></span>}
                {econ.setupFeeCents != null && <span>Setup fee: <span className="font-medium text-ink">{money(econ.setupFeeCents)}</span></span>}
              </div>
            )}
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Margins are estimates at the reference retail price — your actual retail and invoicing are set by your Scalix26 agreement.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><ShieldCheck className="h-5 w-5" /></div>
            <h3 className="font-semibold text-ink">{label} agreement</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-subtle">Your {isWL ? 'white-label' : 'reseller'} pricing is managed by your Scalix26 agreement. Contact us for wholesale pricing, retail guidance, and billing details.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
          </div>
        )}
      </Panel>

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted"><Mail className="h-3.5 w-3.5" /> Billing questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-accent-strong hover:underline">{SUPPORT_EMAIL}</a></p>
    </div>
  )
}

function PriceCell({ icon: Icon, label, value, note, accent }: { icon: typeof Tag; label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-accent/25 bg-accent/[0.05]' : 'border-hairline bg-canvas'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted"><Icon className="h-3 w-3" />{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent ? 'text-accent-strong' : 'text-ink'}`}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-muted">{note}</div>}
    </div>
  )
}
