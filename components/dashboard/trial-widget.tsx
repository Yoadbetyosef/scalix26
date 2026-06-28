'use client'

import Link from 'next/link'
import { CreditCard, AlertTriangle, Sparkles } from 'lucide-react'

const BILLING_HREF = '/settings#billing'
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', business: 'Business' }

// Persistent trial/plan status for the (now light) sidebar. Four states: active trial,
// trial low (<=3 days), trial expired (<=0), and paid plan. Never shows prices.
export function TrialWidget({ plan, trialEndsAt }: { plan: string | null; trialEndsAt: string | null }) {
  const isTrial = !plan || plan === 'trial'

  // ── Paid plan ──────────────────────────────────────────────────────────────
  if (!isTrial) {
    const label = PLAN_LABEL[plan as string] || `${(plan as string).charAt(0).toUpperCase()}${(plan as string).slice(1)}`
    return (
      <>
        <Link href={BILLING_HREF} className="hidden xl:block rounded-xl bg-sunken px-3 py-3 hover:bg-hairline-strong transition-colors">
          <p className="text-[11px] uppercase tracking-wide text-muted">Current plan</p>
          <p className="text-sm font-semibold text-ink">{label} Plan</p>
          <span className="text-xs text-subtle">Manage</span>
        </Link>
        <Link href={BILLING_HREF} title={`${label} Plan`} className="xl:hidden flex items-center justify-center w-10 h-10 mx-auto rounded-xl bg-sunken text-subtle hover:bg-hairline-strong transition-colors">
          <CreditCard className="w-5 h-5" />
        </Link>
      </>
    )
  }

  // ── Trial ────────────────────────────────────────────────────────────────────
  const daysLeft = trialEndsAt ? Math.max(0, Math.floor((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : null
  const expired = daysLeft !== null && daysLeft <= 0
  const low = daysLeft !== null && daysLeft <= 3
  const urgent = expired || low

  const title = expired
    ? 'Trial ended'
    : daysLeft === null
      ? 'Free trial'
      : `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`

  const panel = expired
    ? 'bg-red-50 border border-red-200'
    : low
      ? 'bg-amber-50 border border-amber-200'
      : 'bg-sunken border border-hairline'
  const titleColor = expired ? 'text-red-600' : low ? 'text-amber-700' : 'text-ink'
  const btn = urgent ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-black hover:bg-black/90 text-white'
  const dot = expired ? 'bg-red-500' : low ? 'bg-amber-500' : 'bg-accent'

  return (
    <>
      {/* Expanded sidebar */}
      <div className={`hidden xl:block rounded-xl px-3 py-3 ${panel}`}>
        <p className={`text-sm font-semibold flex items-center gap-1.5 ${titleColor}`}>
          {urgent && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
          {title}
        </p>
        <Link href={BILLING_HREF} className={`mt-2 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${btn}`}>
          <Sparkles className="w-3.5 h-3.5" />
          {expired ? 'Upgrade now' : 'Upgrade'}
        </Link>
      </div>
      {/* Collapsed sidebar — icon + urgency dot */}
      <Link href={BILLING_HREF} title={expired ? 'Trial ended — Upgrade' : title} className="xl:hidden relative flex items-center justify-center w-10 h-10 mx-auto rounded-xl bg-sunken text-ink hover:bg-hairline-strong transition-colors">
        <Sparkles className="w-5 h-5" />
        <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${dot}`} />
      </Link>
    </>
  )
}
