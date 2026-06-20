'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Users, ShieldCheck, MessagesSquare, Activity, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
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

export function ImpactDashboard({ data, businessName }: { data: ImpactData; businessName: string }) {
  const opp = data.opportunities.value

  // Channel recap sentence, e.g. "3 by text, 2 by phone, 13 by email" (count>0 only).
  const channelLine = data.channelBreakdown.map((c) => `${c.count} ${c.label}`).join(', ')

  const takeoverLine =
    data.humanTakeoverCount === 0
      ? 'Handled every conversation without needing you.'
      : data.humanTakeoverCount === 1
        ? 'Required your attention just once.'
        : `Required your attention ${data.humanTakeoverCount} times.`

  // Rotating hero lines — built from real props, only those with a value > 0.
  // Each is a single template-literal string (guaranteed spacing — no JSX adjacency).
  const coverage = data.coveragePct.value
  const heroLines: { headline: string; subtext?: string }[] = []
  if (opp > 0) heroLines.push({
    headline: `${opp} potential ${opp === 1 ? 'customer' : 'customers'} reached you when you couldn’t answer.`,
    subtext: 'Every one of them received an immediate response instead of being ignored, delayed, or lost.',
  })
  if (coverage !== null && coverage > 0) heroLines.push({
    headline: `Scalix kept your business responsive ${coverage}% of the time customers reached out.`,
  })
  if (data.customersHelped.value > 0) heroLines.push({
    headline: `Scalix assisted ${data.customersHelped.value} ${data.customersHelped.value === 1 ? 'customer' : 'customers'} this month.`,
  })
  if (data.conversationsManaged.value > 0) heroLines.push({
    headline: `Scalix handled ${data.conversationsManaged.value} ${data.conversationsManaged.value === 1 ? 'conversation' : 'conversations'} for you.`,
  })

  // Cycle every ~5s with a smooth fade; static when only one (or zero) line qualifies.
  const [idx, setIdx] = useState(0)
  const [show, setShow] = useState(true)
  useEffect(() => {
    if (heroLines.length < 2) { setShow(true); return }
    let to: ReturnType<typeof setTimeout>
    const iv = setInterval(() => {
      setShow(false)
      to = setTimeout(() => { setIdx((i) => (i + 1) % heroLines.length); setShow(true) }, 350)
    }, 5000)
    return () => { clearInterval(iv); clearTimeout(to) }
  }, [heroLines.length])
  const line = heroLines.length ? heroLines[idx % heroLines.length] : null

  return (
    <div className="space-y-6">
      {/* 1) HERO — rotating real-data lines (fixed height, smooth fade) */}
      <div className="relative overflow-hidden rounded-2xl bg-[#1a1f36] px-6 py-8 sm:px-10 sm:py-10">
        <ShieldCheck className="absolute -right-4 -top-4 w-28 h-28 text-white/5" />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#4ecdc4] mb-3">{data.monthLabel}</p>
        {line ? (
          <div className={`min-h-[120px] sm:min-h-[150px] transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`}>
            <h1 className="text-2xl sm:text-4xl font-bold text-white leading-tight max-w-3xl">{line.headline}</h1>
            {line.subtext && (
              <p className="text-sm sm:text-lg text-white/70 mt-3 max-w-2xl leading-relaxed">{line.subtext}</p>
            )}
          </div>
        ) : (
          <div className="min-h-[120px] sm:min-h-[150px]">
            <h1 className="text-2xl sm:text-4xl font-bold text-white leading-tight max-w-3xl">Scalix is on duty for {businessName}.</h1>
            <p className="text-sm sm:text-lg text-white/70 mt-3 max-w-2xl leading-relaxed">
              The moment a customer reaches out — call, text, or message — they&apos;ll get an immediate response. Your impact will appear here.
            </p>
          </div>
        )}
      </div>

      {/* 2) ATTENTION NEEDED */}
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

      {/* 3) WHAT WOULD HAVE HAPPENED WITHOUT SCALIX — only when there's something to say */}
      {opp > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">What Would Have Happened Without Scalix</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">Without Scalix, these customer moments could have been missed.</p>
          <ul className="space-y-2">
            <li className="text-sm sm:text-[15px] text-gray-700">
              <span className="font-semibold text-gray-900">{opp}</span>
              {` potential ${opp === 1 ? 'customer' : 'customers'} reached out while you were unavailable.`}
            </li>
            <li className="text-sm sm:text-[15px] text-gray-700">
              Without an instant reply, some may have waited — or moved on to another business.
            </li>
          </ul>
        </div>
      )}

      {/* 4) IMPACT METRIC CARDS — exactly four */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ImpactCard icon={Users} label="Customers Assisted" desc="People who received a response without waiting on you.">
          <BigNumber>{data.customersHelped.value.toLocaleString()}</BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-gray-400">{data.customersHelped.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.customersHelped.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={ShieldCheck} label="Potential Customers Protected" desc="People who reached out while you were busy, unavailable, or after hours.">
          <BigNumber>{data.opportunities.value.toLocaleString()}</BigNumber>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-gray-400">{data.opportunities.lifetime.toLocaleString()} since you started</span>
            <Trend pct={data.opportunities.trendPct} />
          </div>
        </ImpactCard>

        <ImpactCard icon={MessagesSquare} label="Conversations Handled Without You" desc="Calls, texts, emails, chats, and social messages Scalix helped manage.">
          <BigNumber>{data.conversationsManaged.value.toLocaleString()}</BigNumber>
          <div className="mt-1.5"><Trend pct={data.conversationsManaged.trendPct} /></div>
        </ImpactCard>

        <ImpactCard icon={Activity} label="Business Coverage" desc="Scalix kept your business responsive when customers reached out.">
          {data.coveragePct.value === null ? (
            <>
              <p className="text-2xl font-semibold text-gray-300 leading-none">—</p>
              <p className="text-xs text-gray-400 mt-2">Appears once customers reach out this month.</p>
            </>
          ) : (
            <>
              <BigNumber>{data.coveragePct.value}%</BigNumber>
              <div className="mt-1.5"><Trend pct={data.coveragePct.trendPct} suffix=" pts" /></div>
            </>
          )}
        </ImpactCard>
        {/* SEAM: add an "Instant Response Speed" card here once per-message
            receive-vs-reply timestamps exist (not derivable today — never faked). */}
      </div>

      {/* 5) YOUR AI EMPLOYEE THIS MONTH — per-channel recap (new info, not the cards) */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3">Your AI Employee This Month</h2>
        <Card>
          <CardContent className="p-5 sm:p-6">
            {data.channelBreakdown.length === 0 ? (
              <p className="text-sm text-gray-500">Scalix is ready — as customers reach out, {businessName}&apos;s recap will appear here.</p>
            ) : (
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4ecdc4] flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-gray-700">Responded across your channels: <span className="font-medium text-gray-900">{channelLine}</span>.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4ecdc4] flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-gray-700">{takeoverLine}</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4ecdc4] flex-shrink-0 mt-0.5" />
                  <span className="text-sm sm:text-[15px] text-gray-700">Kept your business responsive whenever customers reached out.</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
