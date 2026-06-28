'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  X, Phone, MessageSquare, Mail, Globe, MessageCircle, MessagesSquare, Camera, Search, ExternalLink,
  Loader2, Inbox, AlertTriangle, UserRound, Sparkles, ChevronDown, ChevronUp, Clock, UserPlus, CalendarCheck, Send,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type OutcomeTag = { label: string; tone: 'green' | 'blue' | 'purple' | 'indigo' | 'amber' | 'gray' }
type ProofRow = {
  id: string
  kind: 'conversation' | 'lead'
  name: string
  channel: string | null
  createdAt: string
  summary: string
  href: string
  pills: OutcomeTag[]
  ownerTimeSaved: boolean
  statusKind: 'saved' | 'takeover' | 'no_response'
}
type TimelineEvent = { at: string; kind: 'inbound' | 'outbound' | 'lead' | 'appointment' | 'followup'; text?: string; label?: string }

export interface DrawerConfig { metric: string; title: string; subtitle: string; headerCount: string }

const CHANNEL: Record<string, { icon: React.ElementType; label: string; cls: string }> = {
  sms: { icon: MessageSquare, label: 'Text', cls: 'bg-blue-50 text-blue-600' },
  voice: { icon: Phone, label: 'Phone', cls: 'bg-emerald-50 text-emerald-600' },
  email: { icon: Mail, label: 'Email', cls: 'bg-rose-50 text-rose-600' },
  instagram: { icon: Camera, label: 'Instagram', cls: 'bg-pink-50 text-pink-600' },
  facebook: { icon: Globe, label: 'Facebook', cls: 'bg-indigo-50 text-indigo-600' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp', cls: 'bg-green-50 text-green-600' },
  webchat: { icon: MessagesSquare, label: 'Web Chat', cls: 'bg-teal-50 text-teal-600' },
  lead: { icon: UserRound, label: 'Lead', cls: 'bg-amber-50 text-amber-600' },
}
const TAG_TONE: Record<OutcomeTag['tone'], string> = {
  green: 'bg-emerald-100 text-emerald-800',
  blue: 'bg-blue-50 text-blue-700',
  purple: 'bg-purple-50 text-purple-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  amber: 'bg-amber-50 text-amber-700',
  gray: 'bg-sunken text-subtle',
}
const TL_ICON: Record<TimelineEvent['kind'], { icon: React.ElementType; cls: string }> = {
  inbound: { icon: MessageSquare, cls: 'bg-sunken text-subtle' },
  outbound: { icon: Sparkles, cls: 'bg-[#5B6CF0]/15 text-[#4338CA]' },
  lead: { icon: UserPlus, cls: 'bg-blue-50 text-blue-600' },
  appointment: { icon: CalendarCheck, cls: 'bg-emerald-50 text-emerald-600' },
  followup: { icon: Send, cls: 'bg-indigo-50 text-indigo-600' },
}

function ConversationTimeline({ conversationId }: { conversationId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setError(false); setEvents(null)
    fetch(`/api/dashboard/impact/timeline?conversation=${conversationId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (active) setEvents(d.events || []) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [conversationId])

  if (error) return <p className="text-xs text-amber-600 px-3 py-3">Couldn&apos;t load the timeline.</p>
  if (events === null) return <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading timeline…</div>
  if (events.length === 0) return <p className="text-xs text-muted px-3 py-3">No recorded events.</p>

  return (
    <div className="px-3 pb-3 pt-1">
      <ol className="relative border-l border-hairline-strong ml-3 space-y-3">
        {events.map((e, i) => {
          const cfg = TL_ICON[e.kind]
          const Icon = cfg.icon
          const milestone = e.kind === 'lead' || e.kind === 'appointment' || e.kind === 'followup'
          return (
            <li key={i} className="ml-4">
              <span className={`absolute -left-[13px] w-6 h-6 rounded-full flex items-center justify-center ${cfg.cls}`}>
                <Icon className="w-3 h-3" />
              </span>
              <p className={`text-xs ${milestone ? 'font-semibold text-ink' : 'text-ink'}`}>
                {milestone ? e.label : (e.kind === 'outbound' ? 'Scalix' : 'Customer')}
              </p>
              {!milestone && e.text && <p className="text-xs text-subtle mt-0.5 line-clamp-2">{e.text}</p>}
              <p className="text-[10px] text-muted mt-0.5">{formatDateTime(e.at)}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ProofRowItem({ row }: { row: ProofRow }) {
  const [open, setOpen] = useState(false)
  const ch = CHANNEL[row.channel || ''] || { icon: MessageCircle, label: row.channel || 'Conversation', cls: 'bg-sunken text-subtle' }
  const Icon = ch.icon
  const expandable = row.kind === 'conversation'
  return (
    <div className="rounded-xl border border-hairline overflow-hidden">
      <button type="button" onClick={() => expandable && setOpen((v) => !v)} className={`w-full text-left p-3.5 ${expandable ? 'hover:bg-sunken/60' : ''} transition-colors`}>
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ch.cls}`}>
            <Icon className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-ink truncate">{row.name}</span>
              {row.pills.map((p, i) => (
                <span key={i} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TAG_TONE[p.tone]}`}>{p.label}</span>
              ))}
              {row.statusKind === 'takeover' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">You stepped in</span>}
              {row.statusKind === 'no_response' && row.kind === 'conversation' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sunken text-subtle">No response</span>}
            </div>

            {/* Consolidated automation block */}
            {row.ownerTimeSaved && (
              <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-800">Owner Time Saved</span>
                </div>
                <p className="text-[11px] text-emerald-700/90 mt-0.5">No owner involvement required · Handled automatically by Scalix.</p>
              </div>
            )}

            <p className="text-xs text-muted mt-1.5">{ch.label} · {formatDateTime(row.createdAt)}</p>
            {row.summary && <p className="text-xs text-subtle mt-1 line-clamp-2">{row.summary}</p>}
          </div>
          {expandable && (open ? <ChevronUp className="w-4 h-4 text-muted flex-shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted flex-shrink-0 mt-1" />)}
        </div>
      </button>

      {open && expandable && (
        <div className="border-t border-hairline bg-sunken/40">
          <ConversationTimeline conversationId={row.id} />
          <Link href={row.href} className="flex items-center gap-1 text-xs font-medium text-[#4338CA] hover:underline px-3.5 pb-3">
            Open conversation <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
      {!expandable && (
        <Link href={row.href} className="flex items-center gap-1 text-xs font-medium text-[#4338CA] hover:underline px-3.5 pb-3 -mt-1">
          Open <ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}

export function DrillDownDrawer({ config, onClose }: { config: DrawerConfig | null; onClose: () => void }) {
  const [rows, setRows] = useState<ProofRow[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [scoreboard, setScoreboard] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const metric = config?.metric

  async function load(offset: number) {
    if (!metric) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/dashboard/impact/drilldown?metric=${metric}&offset=${offset}&limit=50`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTotal(data.total)
      setHasMore(data.hasMore)
      setScoreboard(data.scoreboard || [])
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!metric) return
    setRows([]); setQ(''); setTotal(0); setHasMore(false); setScoreboard([])
    load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric])

  const open = !!config
  const filtered = q ? rows.filter((r) => `${r.name} ${r.summary}`.toLowerCase().includes(q.toLowerCase())) : rows

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      <div className={`fixed top-0 right-0 h-full w-full sm:max-w-md bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {config && (
          <>
            <div className="flex items-start justify-between gap-3 p-5 border-b border-hairline">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-ink">{config.title}</h2>
                  <span className="text-xs font-semibold text-[#4338CA] bg-[#5B6CF0]/10 px-2 py-0.5 rounded-full">{config.headerCount}</span>
                </div>
                {scoreboard.length > 0 ? (
                  <p className="text-xs text-subtle mt-1">{scoreboard.join(' · ')}</p>
                ) : (
                  <p className="text-xs text-subtle mt-1">{config.subtitle}</p>
                )}
              </div>
              <button onClick={onClose} className="tap-target text-muted hover:text-subtle flex-shrink-0 -mt-1 -mr-1 p-1"><X className="w-5 h-5" /></button>
            </div>

            {rows.length > 8 && (
              <div className="px-5 pt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these records…" className="w-full h-10 pl-9 pr-3 rounded-lg border border-hairline-strong text-sm focus:border-[#5B6CF0] focus:outline-none focus:ring-1 focus:ring-[#5B6CF0]" />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
              {error ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-subtle py-12">
                  <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
                  <p className="text-sm font-medium text-ink">Couldn&apos;t load these records</p>
                  <button onClick={() => load(0)} className="mt-3 text-sm font-medium text-[#4338CA] hover:underline">Try again</button>
                </div>
              ) : loading && rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p className="text-sm">Loading records…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted py-12 text-center">
                  <Inbox className="w-10 h-10 mb-3 text-muted" />
                  <p className="text-sm font-medium text-subtle">{q ? 'No matches' : 'Nothing to show here'}</p>
                  <p className="text-xs mt-1">{q ? 'Try a different search.' : 'These records will appear as customers reach out.'}</p>
                </div>
              ) : (
                <>
                  {filtered.map((r) => <ProofRowItem key={`${r.kind}-${r.id}`} row={r} />)}
                  {!q && hasMore && (
                    <button onClick={() => load(rows.length)} disabled={loading} className="w-full py-2.5 text-sm font-medium text-[#4338CA] hover:bg-sunken rounded-lg disabled:opacity-50">
                      {loading ? 'Loading…' : `Load more (${rows.length} of ${total})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
