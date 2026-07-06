'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, CheckCircle2, Clock, TrendingDown, DollarSign, CalendarRange, Phone, MessageSquare, UserPlus, CalendarCheck, Bot, Activity } from 'lucide-react'

interface Kpis {
  totalBusinesses: number | null
  activeBusinesses: number | null
  trialBusinesses: number | null
  suspendedBusinesses: number | null
  churnedBusinesses: number | null
  mrr: number | null
  arr: number | null
  callsToday: number | null
  messagesToday: number | null
  leadsToday: number | null
  appointmentsToday: number | null
  activeAgents: number | null
  systemHealth: string
}

const money = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString()}`)
const num = (n: number | null) => (n === null ? 'Not tracked' : n.toLocaleString())

export default function AdminDashboard() {
  const [k, setK] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/overview')
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Failed to load')
        setK(d.kpis)
      } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
    })()
  }, [])

  const health = k?.systemHealth === 'operational'
    ? { text: 'Operational', cls: 'text-emerald-600', dot: 'bg-emerald-500' }
    : { text: 'Degraded', cls: 'text-red-600', dot: 'bg-red-500' }

  const tiles: { label: string; value: string; icon: typeof Building2 }[] = k ? [
    { label: 'Total Businesses', value: num(k.totalBusinesses), icon: Building2 },
    { label: 'Active', value: num(k.activeBusinesses), icon: CheckCircle2 },
    { label: 'Trial', value: num(k.trialBusinesses), icon: Clock },
    { label: 'Churned', value: k.churnedBusinesses === null ? 'Not tracked yet' : num(k.churnedBusinesses), icon: TrendingDown },
    { label: 'MRR', value: money(k.mrr), icon: DollarSign },
    { label: 'ARR', value: money(k.arr), icon: CalendarRange },
    { label: 'AI Calls Today', value: num(k.callsToday), icon: Phone },
    { label: 'Messages Today', value: num(k.messagesToday), icon: MessageSquare },
    { label: 'Leads Today', value: num(k.leadsToday), icon: UserPlus },
    { label: 'Appointments Today', value: num(k.appointmentsToday), icon: CalendarCheck },
    { label: 'Active AI Agents', value: num(k.activeAgents), icon: Bot },
  ] : []

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-subtle">Platform overview — live figures from the database.</p>
        </div>
        <Link href="/admin/businesses" className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90">All businesses →</Link>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-hairline-strong bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-subtle">
                  <t.icon className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">{t.label}</span>
                </div>
                <div className="text-2xl font-bold text-ink">{t.value}</div>
              </div>
            ))}
            <Link href="/admin/health" className="rounded-xl border border-hairline-strong bg-white p-4 transition-colors hover:border-accent/50">
              <div className="mb-2 flex items-center gap-2 text-subtle">
                <Activity className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">System Health</span>
              </div>
              <div className={`flex items-center gap-2 text-lg font-bold ${health.cls}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${health.dot}`} />
                {health.text}
              </div>
              <div className="mt-1 text-xs text-subtle">View live status →</div>
            </Link>
          </div>
          <p className="mt-4 text-xs text-subtle">
            External API health (OpenAI, Deepgram, Twilio, Stripe, Meta, Google, Microsoft) and churn/billing metrics are wired in a later phase — shown as “Not tracked yet” until then.
          </p>
        </>
      )}
    </div>
  )
}
