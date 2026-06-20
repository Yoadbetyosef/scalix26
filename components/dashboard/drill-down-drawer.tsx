'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Phone, MessageSquare, Mail, Globe, MessageCircle, Search, ExternalLink, Loader2, Inbox, AlertTriangle, UserRound } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type ProofRow = {
  id: string
  kind: 'conversation' | 'lead'
  name: string
  channel: string | null
  createdAt: string
  statusKey: 'responded' | 'takeover' | 'no_response' | 'awaiting_followup'
  summary: string
  href: string
}

export interface DrawerConfig { metric: string; title: string; subtitle: string; headerCount: string }

const CHANNEL_ICON: Record<string, React.ElementType> = {
  sms: MessageSquare, voice: Phone, email: Mail, instagram: Globe, facebook: Globe, whatsapp: MessageCircle, webchat: MessageCircle, lead: UserRound,
}
const CHANNEL_LABEL: Record<string, string> = {
  sms: 'Text', voice: 'Phone', email: 'Email', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', webchat: 'Web Chat', lead: 'Lead',
}
const STATUS: Record<ProofRow['statusKey'], { label: string; cls: string }> = {
  responded: { label: 'Responded by Scalix', cls: 'bg-[#4ecdc4]/15 text-[#3db8af]' },
  takeover: { label: 'You stepped in', cls: 'bg-indigo-50 text-indigo-600' },
  no_response: { label: 'No response', cls: 'bg-amber-50 text-amber-700' },
  awaiting_followup: { label: 'Awaiting follow-up', cls: 'bg-amber-50 text-amber-700' },
}

function ProofRowItem({ row }: { row: ProofRow }) {
  const Icon = CHANNEL_ICON[row.channel || ''] || MessageCircle
  const st = STATUS[row.statusKey]
  return (
    <Link href={row.href} className="block group">
      <div className="rounded-xl border border-gray-100 p-3.5 hover:border-[#4ecdc4]/40 hover:bg-gray-50/60 transition-colors">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
            <Icon className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">{row.name}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{CHANNEL_LABEL[row.channel || ''] || row.channel || 'Conversation'} · {formatDateTime(row.createdAt)}</p>
            {row.summary && <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{row.summary}</p>}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#3db8af] mt-2 group-hover:underline">
              Open conversation <ExternalLink className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

export function DrillDownDrawer({ config, onClose }: { config: DrawerConfig | null; onClose: () => void }) {
  const [rows, setRows] = useState<ProofRow[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
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
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!metric) return
    setRows([])
    setQ('')
    setTotal(0)
    setHasMore(false)
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
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">{config.title}</h2>
                  <span className="text-xs font-semibold text-[#3db8af] bg-[#4ecdc4]/10 px-2 py-0.5 rounded-full">{config.headerCount}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{config.subtitle}</p>
              </div>
              <button onClick={onClose} className="tap-target text-gray-400 hover:text-gray-600 flex-shrink-0 -mt-1 -mr-1 p-1"><X className="w-5 h-5" /></button>
            </div>

            {/* Search (only when there are enough rows to warrant it) */}
            {rows.length > 8 && (
              <div className="px-5 pt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search these records…"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 text-sm focus:border-[#4ecdc4] focus:outline-none focus:ring-1 focus:ring-[#4ecdc4]"
                  />
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
              {error ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 py-12">
                  <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
                  <p className="text-sm font-medium text-gray-700">Couldn&apos;t load these records</p>
                  <button onClick={() => load(0)} className="mt-3 text-sm font-medium text-[#3db8af] hover:underline">Try again</button>
                </div>
              ) : loading && rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p className="text-sm">Loading records…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12 text-center">
                  <Inbox className="w-10 h-10 mb-3 text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">{q ? 'No matches' : 'Nothing to show here'}</p>
                  <p className="text-xs mt-1">{q ? 'Try a different search.' : 'These records will appear as customers reach out.'}</p>
                </div>
              ) : (
                <>
                  {filtered.map((r) => <ProofRowItem key={`${r.kind}-${r.id}`} row={r} />)}
                  {!q && hasMore && (
                    <button onClick={() => load(rows.length)} disabled={loading} className="w-full py-2.5 text-sm font-medium text-[#3db8af] hover:bg-gray-50 rounded-lg disabled:opacity-50">
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
