'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Trophy, TrendingDown, MonitorPlay, MousePointerClick, Target, Palette, Link2, DollarSign, Search, FlaskConical, ArrowRight, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Nav, Tab } from '@/components/partner/marketing-ui'

interface Rec { id: string; severity: 'bad' | 'warn' | 'good' | 'info'; icon: string; title: string; detail: string; action?: { label: string; tab: string; campaignId?: string } }

const ICONS: Record<string, LucideIcon> = {
  trophy: Trophy, trenddown: TrendingDown, demo: MonitorPlay, click: MousePointerClick, target: Target,
  palette: Palette, link: Link2, sparkles: Sparkles, dollar: DollarSign, search: Search, test: FlaskConical,
}
const TONE: Record<Rec['severity'], { dot: string; chip: string }> = {
  bad: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700' },
  warn: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  good: { dot: 'bg-green-500', chip: 'bg-green-50 text-green-700' },
  info: { dot: 'bg-accent', chip: 'bg-accent/10 text-accent-strong' },
}
const LABEL: Record<Rec['severity'], string> = { bad: 'Fix now', warn: 'Improve', good: 'Do more', info: 'Opportunity' }

export function MarketingIntelPanel({ nav }: { nav: Nav }) {
  const [recs, setRecs] = useState<Rec[] | null>(null)
  const [open, setOpen] = useState(true)
  useEffect(() => { fetch('/api/partner/marketing/intel').then((r) => r.json()).then((j) => setRecs(j.recs || [])) }, [])

  if (!recs || recs.length === 0) return null

  return (
    <div className="rounded-2xl border border-accent/20 bg-gradient-to-b from-accent/[0.06] to-transparent shadow-e1">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent-strong"><Sparkles className="h-4 w-4" /></span>
          <span className="font-semibold text-ink">Marketing Intelligence</span>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-strong">{recs.length}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
          {recs.map((r) => {
            const Icon = ICONS[r.icon] || Sparkles
            const tone = TONE[r.severity]
            return (
              <div key={r.id} className="flex flex-col rounded-xl border border-hairline bg-surface p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sunken text-subtle"><Icon className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.chip}`}>{LABEL[r.severity]}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium leading-snug text-ink">{r.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-subtle">{r.detail}</div>
                    {r.action && (
                      <button onClick={() => nav.go(r.action!.tab as Tab, r.action!.campaignId)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
                        {r.action.label} <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
