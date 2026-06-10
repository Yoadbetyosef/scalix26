'use client'

import { TrendingUp, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDateTime } from '@/lib/utils'
import type { Lead, LeadSource, LeadStatus } from '@/types'

const SOURCE_LABELS: Record<LeadSource, string> = {
  missed_call: 'Missed Call',
  web_form: 'Web Form',
  google_lsa: 'Google LSA',
  facebook: 'Facebook',
  yelp: 'Yelp',
  angi: 'Angi',
  other: 'Other',
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'bg-blue-50 text-blue-700',
  contacted: 'bg-yellow-50 text-yellow-700',
  booked: 'bg-green-50 text-green-700',
  lost: 'bg-gray-100 text-gray-500',
}

function responseTime(createdAt: string, respondedAt: string | null): string {
  if (!respondedAt) return '—'
  const sec = Math.max(0, Math.round((new Date(respondedAt).getTime() - new Date(createdAt).getTime()) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

export function LeadsTable({ leads, links }: { leads: Lead[]; links: Record<string, string> }) {
  const router = useRouter()

  if (!leads.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 bg-white rounded-xl border border-gray-100 shadow-sm">
        <TrendingUp className="w-12 h-12 mb-3" />
        <p className="text-sm">No leads yet</p>
        <p className="text-xs text-gray-400 mt-1 text-center px-4">Leads appear here automatically when a customer reaches out from any source</p>
      </div>
    )
  }

  return (
    <>
      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {leads.map((lead) => {
          const href = links[lead.id]
          const inner = (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <StatusBadge status={lead.status} />
                  {href && <ChevronRight className="w-4 h-4 text-gray-300" />}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-gray-600">
                <span className="text-gray-400">Source</span>
                <span className="text-right">{SOURCE_LABELS[lead.source] || lead.source}</span>
                <span className="text-gray-400">Phone</span>
                <span className="text-right break-all">{lead.phone}</span>
                <span className="text-gray-400">Response</span>
                <span className="text-right">{responseTime(lead.created_at, lead.responded_at)}</span>
                <span className="text-gray-400">Created</span>
                <span className="text-right">{formatDateTime(lead.created_at)}</span>
              </div>
            </>
          )
          return href ? (
            <Link key={lead.id} href={href} className="tap-target block bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              {inner}
            </Link>
          ) : (
            <div key={lead.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              {inner}
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-50">
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Response Time</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Created At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {leads.map((lead) => {
              const href = links[lead.id]
              return (
                <tr
                  key={lead.id}
                  onClick={href ? () => router.push(href) : undefined}
                  className={`transition-colors ${href ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
                >
                  <td className="px-6 py-4 text-sm text-gray-700">{SOURCE_LABELS[lead.source] || lead.source}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{lead.name || 'Unknown'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 break-all">{lead.phone}</td>
                  <td className="px-6 py-4"><StatusBadge status={lead.status} /></td>
                  <td className="px-6 py-4 text-sm text-gray-600">{responseTime(lead.created_at, lead.responded_at)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDateTime(lead.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
