'use client'

import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Shared primitives + helpers for the Marketing OS surfaces (mobile-first, premium).

export type Tab = 'performance' | 'campaigns' | 'creatives' | 'landing' | 'spend' | 'assets'
export interface Nav { go: (tab: Tab, campaignId?: string) => void }

export const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
export const textarea = 'w-full rounded-lg border border-hairline-strong p-2.5 text-sm outline-none focus:border-accent'
export const label = 'mb-1 block text-xs font-medium text-subtle'
export const CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'organic', 'email', 'other']
export const PLATFORMS = ['meta', 'google', 'tiktok', 'linkedin', 'youtube', 'other']
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-50 text-green-700', published: 'bg-green-50 text-green-700', winner: 'bg-green-50 text-green-700',
  paused: 'bg-amber-50 text-amber-700', testing: 'bg-amber-50 text-amber-700',
  archived: 'bg-gray-100 text-gray-500', draft: 'bg-sunken text-subtle',
}

export function EducationalEmpty({ icon: Icon, title, body, cta }: { icon: LucideIcon; title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-6 text-center sm:p-10">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Icon className="h-5 w-5" /></div>
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-subtle">{body}</p>
      {cta && <div className="mt-4 flex justify-center">{cta}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="truncate pr-2 font-semibold text-ink">{title}</div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// Compact metric with a manual/auto tint dot.
export function Metric({ label: l, value, tone, note }: { label: string; value: string; tone?: 'good' | 'bad'; note?: 'manual' | 'auto' }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
        <span className="truncate">{l}</span>{note && <span className={`inline-block h-1 w-1 shrink-0 rounded-full ${note === 'auto' ? 'bg-green-500' : 'bg-amber-500'}`} />}
      </div>
      <div className={`truncate text-sm font-semibold tabular-nums ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

export { parseVideo } from '@/lib/partner/media'
export type { ParsedVideo } from '@/lib/partner/media'
