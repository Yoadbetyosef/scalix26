'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WarRoomGap, TaskScope, TaskPriority } from '@/lib/command-center/war-room'
import type { WarRoomTask } from '@/lib/command-center/war-room-store'

const money = (c: number) => (c >= 100000 ? `$${(c / 100000).toFixed(0)}K` : `$${(c / 100).toFixed(0)}`)
const P_TONE: Record<TaskPriority, string> = { critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }
const SCOPES: [TaskScope, string][] = [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month']]
const post = (method: string, body: unknown) => fetch('/api/admin/command-center/war-room', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function WarRoomView({ gaps, tasks }: { gaps: WarRoomGap[]; tasks: WarRoomTask[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)

  const accept = async (g: WarRoomGap) => { setBusy(true); setErr(null); try { const r = await post('POST', { action: 'accept_gap', gap: g }); if (!r.ok) throw new Error((await r.json()).error || 'Failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const setStatus = async (t: WarRoomTask, status: string, dismissReason?: string) => { setBusy(true); setErr(null); try { const r = await post('PATCH', { id: t.id, status, dismissReason: dismissReason ?? null }); if (!r.ok) throw new Error((await r.json()).error || 'Failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const dismiss = async (t: WarRoomTask) => { const reason = prompt('Dismiss reason?'); if (reason == null) return; await setStatus(t, 'dismissed', reason) }

  const activeTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress')

  return (
    <div className="space-y-5">
      {err && <div className="text-xs text-red-600">{err}</div>}
      {SCOPES.map(([scope, label]) => {
        const scopeGaps = gaps.filter((g) => g.scope === scope)
        const scopeTasks = activeTasks.filter((t) => t.scope === scope)
        if (scopeGaps.length === 0 && scopeTasks.length === 0) return (
          <div key={scope}><h3 className="mb-1 text-sm font-semibold text-ink">{label}</h3><div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-3 text-xs text-subtle">Nothing off-track. No fabricated work.</div></div>
        )
        return (
          <div key={scope}>
            <h3 className="mb-2 text-sm font-semibold text-ink">{label}</h3>
            <div className="space-y-2">
              {scopeGaps.map((g) => (
                <div key={g.gapKey} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-3">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${P_TONE[g.priority]}`}>{g.priority}</span>
                  <span className="text-sm text-ink">{g.title}</span>
                  {g.expectedImpactCents != null && g.expectedImpactCents > 0 && <span className="text-xs font-medium text-emerald-700">{money(g.expectedImpactCents)} impact</span>}
                  <span className="ml-auto text-[10px] text-subtle">generated from live gap</span>
                  <button onClick={() => accept(g)} disabled={busy} className="rounded bg-ink px-2 py-1 text-xs font-medium text-white">Add to War Room</button>
                </div>
              ))}
              {scopeTasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline-strong bg-white p-3">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${P_TONE[t.priority]}`}>{t.priority}</span>
                  {t.status === 'in_progress' && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">in progress</span>}
                  <span className="text-sm font-medium text-ink">{t.title}</span>
                  {t.requiredResult != null && <span className="text-xs text-subtle">need {t.requiredResult}{t.actual != null ? ` · done ${t.actual} · ${Math.max(0, t.requiredResult - t.actual)} left` : ''}</span>}
                  {t.expectedImpactCents != null && t.expectedImpactCents > 0 && <span className="text-xs font-medium text-emerald-700">{money(t.expectedImpactCents)}</span>}
                  {t.owner && <span className="text-xs text-subtle">· {t.owner}</span>}
                  <span className="ml-auto flex gap-2">
                    {t.status === 'open' && <button onClick={() => setStatus(t, 'in_progress')} disabled={busy} className="text-xs text-ink underline">Start</button>}
                    <button onClick={() => setStatus(t, 'done')} disabled={busy} className="text-xs text-emerald-700 underline">Done</button>
                    <button onClick={() => dismiss(t)} disabled={busy} className="text-xs text-red-600 underline">Dismiss</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className="text-[11px] text-subtle">Completed/dismissed tasks are retained in history (audited). Tasks are generated from gaps between actual, target, plan, capacity and risk — not a generic to-do list.</div>
    </div>
  )
}
