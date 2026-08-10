'use client'

import { FALLBACK_BRAND_NAME } from '@/lib/partner/brand'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Users, ShieldCheck, MessagesSquare, Activity, ArrowUpRight, ArrowDownRight, CheckCircle2, ShieldAlert } from 'lucide-react'
import type { ImpactData } from '@/lib/dashboard/impact'
import { DrillDownDrawer, type DrawerConfig } from '@/components/dashboard/drill-down-drawer'
import { CountUp } from '@/components/ui/count-up'
import { BusinessBrainCard } from '@/components/dashboard/business-brain-card'
import { AttentionNeeded } from '@/components/dashboard/attention-needed'
import type { AttentionItem } from '@/lib/dashboard/impact'
import { useBrand } from '@/components/brand/brand-provider'

function Trend({ pct, suffix = '%' }: { pct: number | null; suffix?: string }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  // Positive momentum reads green (Apple-style), a dip stays quiet — never alarming.
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-600' : 'text-muted'}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {Math.abs(pct)}{suffix} vs last month
    </span>
  )
}

// Apple-style colored icon tile — the element that brings the metric alive while the
// surface stays calm/white.
const TILE_TONES = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  purple: 'bg-violet-500',
  amber: 'bg-amber-500',
} as const

function ImpactCard({ icon: Icon, label, desc, tone, children, onClick }: { icon: React.ElementType; label: string; desc: string; tone: keyof typeof TILE_TONES; children: React.ReactNode; onClick?: () => void }) {
  const clickable = !!onClick
  return (
    <Card onClick={onClick} className={`overflow-hidden ${clickable ? 'cursor-pointer hover:shadow-e2 hover:-translate-y-0.5 transition-all' : ''}`}>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className={`w-9 h-9 rounded-xl ${TILE_TONES[tone]} flex items-center justify-center text-white shadow-e1 flex-shrink-0`}>
            <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <span className="text-sm font-medium text-subtle">{label}</span>
        </div>
        {children}
        <p className="text-xs text-muted mt-2.5 leading-relaxed">{desc}</p>
        {clickable && <p className="text-[11px] font-medium text-subtle mt-2">Click to view details →</p>}
      </CardContent>
    </Card>
  )
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return <p className="sx-tabular text-4xl sm:text-5xl font-light tracking-tight text-ink leading-none">{children}</p>
}

export function ImpactDashboard({ data, businessName, brainAgentId, tenantId }: { data: ImpactData; businessName: string; brainAgentId?: string; tenantId: string }) {
  const opp = data.opportunities.value
  // Brand-aware: operator mode → the White Label partner's brand; otherwise Scalix/host brand.
  const brandName = useBrand()?.name || FALLBACK_BRAND_NAME

  // Channel recap sentence, e.g. "3 by text, 2 by phone, 13 by email" (count>0 only).
  const channelLine = data.channelBreakdown.map((c) => `${c.count} ${c.label}`).join(', ')

  const takeoverLine =
    data.humanTakeoverCount === 0
      ? 'Handled every conversation without needing you.'
      : data.humanTakeoverCount === 1
        ? 'Required your attention just once.'
        : `Required your attention ${data.humanTakeoverCount} times.`

  // Drill-down drawer (proof). A card opens it only when its value > 0.
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null)

  return (
    <div className="space-y-5 md:space-y-8">
      {/* Month label — quiet */}
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{data.monthLabel}</p>

      {/* ATTENTION NEEDED + BUSINESS BRAIN — side by side, under the numbers */}
      <div id="attention-needed" className="grid gap-4 md:grid-cols-2 md:items-start scroll-mt-20">
      <div>
        <h2 className="text-lg sm:text-xl font-normal text-ink mb-3">Attention Needed</h2>
        <AttentionNeeded
          items={data.attention}
          tenantId={tenantId}
          onOpenMetric={(item: AttentionItem) => {
            const n = parseInt(item.label, 10) || 0
            const meta = item.metric === 'attention_takeover'
              ? { title: "Conversations You're Handling", subtitle: "Open conversations you've stepped into." }
              : { title: 'Leads Awaiting Follow-up', subtitle: "Leads that haven't been contacted yet." }
            setDrawer({ metric: item.metric!, title: meta.title, subtitle: meta.subtitle, headerCount: `${n}` })
          }}
        />
      </div>
      {brainAgentId && (
        <div>
          <h2 className="text-lg sm:text-xl font-normal text-ink mb-3">Business Brain</h2>
          <BusinessBrainCard agentId={brainAgentId} />
        </div>
      )}
      </div>

      {/* 3) WHAT WOULD HAVE HAPPENED WITHOUT SCALIX — only when there's something to say */}
      {opp > 0 && (
        <div className="rounded-2xl border border-hairline-strong bg-gradient-to-br from-sunken to-white p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-5 h-5 text-muted" />
            <h2 className="text-lg sm:text-xl font-normal text-ink">What Would Have Happened Without {brandName}</h2>
          </div>
          <p className="text-sm text-subtle mb-3">Without {brandName}, these customer moments could have been missed.</p>
          <ul className="space-y-2">
            <li className="text-sm sm:text-[15px] text-ink">
              <span className="font-semibold text-ink">{opp}</span>
              {` potential ${opp === 1 ? 'customer' : 'customers'} reached out while you were unavailable.`}
            </li>
            <li className="text-sm sm:text-[15px] text-ink">
              Without an instant reply, some may have waited — or moved on to another business.
            </li>
          </ul>
        </div>
      )}

      {/* 4) IMPACT METRIC CARDS — exactly four (clickable → proof drawer when value>0) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sx-stagger">
        <ImpactCard icon={Users} label="Customers Assisted" tone="blue" desc="People who received a response without waiting on you."
          onClick={data.customersHelped.value > 0 ? () => setDrawer({ metric: 'customers_assisted', title: `${data.customersHelped.value} Customers Assisted`, subtitle: `People who received a response from your business through ${brandName}.`, headerCount: `${data.customersHelped.value}` }) : undefined}>
          <BigNumber><CountUp value={data.customersHelped.value} /></BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-muted">{data.customersHelped.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.customersHelped.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={ShieldCheck} label="Potential Customers Protected" tone="green" desc="People who reached out while you were busy, unavailable, or after hours."
          onClick={data.opportunities.value > 0 ? () => setDrawer({ metric: 'opportunities', title: `${data.opportunities.value} Potential Customers Protected`, subtitle: `${brandName} handled these customer moments while you focused on running your business.`, headerCount: `${data.opportunities.value}` }) : undefined}>
          <BigNumber><CountUp value={data.opportunities.value} /></BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-muted">{data.opportunities.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.opportunities.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={MessagesSquare} label="Conversations Handled Without You" tone="purple" desc={`Calls, texts, emails, chats, and social messages ${brandName} helped manage.`}
          onClick={data.conversationsManaged.value > 0 ? () => setDrawer({ metric: 'conversations_managed', title: `${data.conversationsManaged.value} Conversations Handled Without You`, subtitle: 'These conversations received responses without requiring your personal attention.', headerCount: `${data.conversationsManaged.value}` }) : undefined}>
          <BigNumber><CountUp value={data.conversationsManaged.value} /></BigNumber>
          <div className="mt-1.5"><Trend pct={data.conversationsManaged.trendPct} /></div>
        </ImpactCard>

        <ImpactCard icon={Activity} label="Business Coverage" tone="amber" desc={`${brandName} kept your business responsive when customers reached out.`}
          onClick={data.coveragePct.value !== null && data.coveragePct.total > 0 ? () => setDrawer({ metric: 'coverage', title: 'Business Coverage', subtitle: `Every customer who reached out, and whether ${brandName} kept you responsive.`, headerCount: `${data.coveragePct.value}%` }) : undefined}>
          {data.coveragePct.value === null ? (
            <>
              <p className="text-2xl font-semibold text-muted leading-none">—</p>
              <p className="text-xs text-muted mt-2">Appears once customers reach out this month.</p>
            </>
          ) : (
            <>
              <BigNumber><CountUp value={data.coveragePct.value} suffix="%" /></BigNumber>
              <div className="mt-1.5"><Trend pct={data.coveragePct.trendPct} suffix=" pts" /></div>
            </>
          )}
        </ImpactCard>
        {/* SEAM: add an "Instant Response Speed" card here once per-message
            receive-vs-reply timestamps exist (not derivable today — never faked). */}
      </div>

      {/* 5) YOUR AI EMPLOYEE THIS MONTH — per-channel recap (new info, not the cards) */}
      <div>
        <h2 className="text-lg sm:text-xl font-normal text-ink mb-3">Your AI Employee This Month</h2>
        <Card>
          <CardContent className="p-5 sm:p-6">
            {data.channelBreakdown.length === 0 ? (
              <p className="text-sm text-subtle">{brandName} is ready — as customers reach out, {businessName}&apos;s recap will appear here.</p>
            ) : (
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-ink">Responded across your channels: <span className="font-medium text-ink">{channelLine}</span>.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-ink">{takeoverLine}</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-ink">Kept your business responsive whenever customers reached out.</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drill-down proof drawer (lazy-loads real records when opened) */}
      <DrillDownDrawer config={drawer} onClose={() => setDrawer(null)} />
    </div>
  )
}
