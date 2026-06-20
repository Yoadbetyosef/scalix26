'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Users, ShieldCheck, MessagesSquare, Clock, Timer, Activity, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import type { ImpactData } from '@/lib/dashboard/impact'

function Trend({ pct, suffix = '%' }: { pct: number | null; suffix?: string }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-gray-400'}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {Math.abs(pct)}{suffix} vs last month
    </span>
  )
}

function ImpactCard({ icon: Icon, label, desc, children }: { icon: React.ElementType; label: string; desc: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#4ecdc4]/10 flex items-center justify-center text-[#3db8af] flex-shrink-0">
            <Icon className="w-[18px] h-[18px]" />
          </div>
          <span className="text-sm font-semibold text-gray-900">{label}</span>
        </div>
        {children}
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  )
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return <p className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 leading-none">{children}</p>
}

function ComingSoon({ note }: { note: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-gray-300 leading-none">—</p>
      <p className="text-xs text-gray-400 mt-2">{note}</p>
    </div>
  )
}

export function ImpactDashboard({ data, businessName }: { data: ImpactData; businessName: string }) {
  // Rotating hero — real sentences only.
  const heroLines = data.hero.length
    ? data.hero
    : ['Scalix is ready — as conversations come in, your impact will appear here.']
  const [heroIdx, setHeroIdx] = useState(0)
  useEffect(() => {
    if (heroLines.length < 2) return
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroLines.length), 5000)
    return () => clearInterval(t)
  }, [heroLines.length])

  return (
    <div className="space-y-6">
      {/* Section title */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Your Business Impact</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          While you focused on running your business, Scalix was working in the background making sure no opportunity was missed.
        </p>
      </div>

      {/* Rotating hero bar */}
      <div className="relative overflow-hidden rounded-2xl bg-[#1a1f36] px-6 py-7 sm:px-8 sm:py-8">
        <Sparkles className="absolute -right-3 -top-3 w-24 h-24 text-white/5" />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#4ecdc4] mb-2">{data.monthLabel}</p>
        <p key={heroIdx} className="text-lg sm:text-2xl font-semibold text-white leading-snug max-w-3xl transition-opacity duration-500">
          {heroLines[heroIdx]}
        </p>
      </div>

      {/* 6 impact cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <ImpactCard icon={Users} label="Customers Helped" desc="People who received a response from Scalix.">
          <BigNumber>{data.customersHelped.value.toLocaleString()}</BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-gray-400">{data.customersHelped.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.customersHelped.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={ShieldCheck} label="Opportunities Captured" desc="Customers who contacted your business when you were unavailable, busy, or after hours.">
          <BigNumber>{data.opportunities.value.toLocaleString()}</BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-gray-400">{data.opportunities.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.opportunities.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={MessagesSquare} label="Conversations Managed" desc="Calls, texts, emails, chats, and social messages handled by Scalix.">
          <BigNumber>{data.conversationsManaged.value.toLocaleString()}</BigNumber>
          <div className="mt-1.5"><Trend pct={data.conversationsManaged.trendPct} /></div>
        </ImpactCard>

        <ImpactCard icon={Clock} label="Time Returned To You" desc="Estimated hours you didn't spend answering phones and messages.">
          <div className="flex items-baseline gap-2">
            <BigNumber>{data.timeReturnedHours.value.toLocaleString()}</BigNumber>
            <span className="text-sm font-medium text-gray-400">hrs</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">estimated</span>
          </div>
          <div className="mt-1.5"><Trend pct={data.timeReturnedHours.trendPct} /></div>
        </ImpactCard>

        <ImpactCard icon={Timer} label="Average Response Time" desc="How quickly customers received a response.">
          <ComingSoon note="We'll show this once response timing is captured per message." />
        </ImpactCard>

        <ImpactCard icon={Activity} label="Availability Coverage" desc="The percentage of time your business remained responsive to customers.">
          {data.coveragePct.value === null ? (
            <ComingSoon note="Appears once customers reach out this month." />
          ) : (
            <>
              <BigNumber>{data.coveragePct.value}%</BigNumber>
              <div className="mt-1.5"><Trend pct={data.coveragePct.trendPct} suffix=" pts" /></div>
            </>
          )}
        </ImpactCard>
      </div>

      {/* What Scalix Did For You */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3">What Scalix Did For You</h2>
        <Card>
          <CardContent className="p-5 sm:p-6">
            {data.report.length === 0 ? (
              <p className="text-sm text-gray-500">Scalix is ready — as conversations come in, {businessName}&apos;s report will appear here.</p>
            ) : (
              <ul className="space-y-3">
                {data.report.map((line, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#4ecdc4] flex-shrink-0 mt-0.5" />
                    <span className="text-sm sm:text-[15px] text-gray-700">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attention Needed */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3">Attention Needed</h2>
        {data.attention.length === 0 ? (
          <Card>
            <CardContent className="p-5 sm:p-6 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              <span className="text-sm text-gray-700">You&apos;re all caught up — Scalix has everything handled.</span>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.attention.map((item, i) => (
              <Link key={i} href={item.href} className="block">
                <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100/70 transition-colors">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-amber-900 flex-1">{item.label}</span>
                  <ArrowUpRight className="w-4 h-4 text-amber-400" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
