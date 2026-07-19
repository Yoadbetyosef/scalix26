'use client'

import { useEffect, useState } from 'react'
import { Workflow, ArrowRight, CircleDot, CheckCircle2, XCircle, Flag } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SectionNav } from '@/components/commerce/section-nav'

interface Stage { id: string; key: string; label: string; is_initial: boolean; is_terminal: boolean; is_success: boolean; is_failed: boolean }
interface Transition { from_stage_id: string | null; to_stage_id: string }
interface Wf { id: string; key: string; name: string; record_type: string; stages: Stage[]; transitions: Transition[] }

export function WorkflowList() {
  const [workflows, setWorkflows] = useState<Wf[] | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/core/workflows').then((r) => r.json()).then((d) => { if (live) setWorkflows(d.workflows ?? []) }).catch(() => { if (live) setWorkflows([]) })
    return () => { live = false }
  }, [])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6"><h1 className="text-2xl font-light tracking-tight text-ink">Workflows</h1><p className="mt-1 text-sm text-muted">Configured stage sets and allowed transitions. Stages are defined per business — never hard-coded.</p></header>

      {!workflows ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : workflows.length === 0 ? (
        <EmptyState icon={Workflow} title="No workflows configured">Workflows model your process (e.g. production → shipping → delivery) as configurable stages. Install a package or define one to see it here.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {workflows.map((wf) => <WorkflowCard key={wf.id} wf={wf} />)}
        </ul>
      )}
    </div>
  )
}

function WorkflowCard({ wf }: { wf: Wf }) {
  const stageById = new Map(wf.stages.map((s) => [s.id, s]))
  const outgoing = (stageId: string) => wf.transitions.filter((t) => t.from_stage_id === stageId).map((t) => stageById.get(t.to_stage_id)?.label).filter(Boolean)
  const initialTargets = wf.transitions.filter((t) => t.from_stage_id === null).map((t) => stageById.get(t.to_stage_id)?.label).filter(Boolean)

  return (
    <li className="rounded-card border border-hairline bg-surface p-4 shadow-e1">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div><h2 className="font-medium text-ink">{wf.name}</h2><p className="text-xs text-muted">for {wf.record_type}</p></div>
        <Badge variant="neutral">{wf.stages.length} stages</Badge>
      </div>

      {/* Stage flow */}
      <div className="no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        {wf.stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-4 w-4 shrink-0 text-hairline-strong" />}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-sunken px-3 py-1 text-sm text-ink">
              <StageIcon s={s} />{s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Allowed transitions (available actions come only from these) */}
      <div className="space-y-1 border-t border-hairline pt-3 text-xs text-subtle">
        {initialTargets.length > 0 && <p><span className="text-muted">Start →</span> {initialTargets.join(', ')}</p>}
        {wf.stages.map((s) => { const out = outgoing(s.id); return out.length ? <p key={s.id}><span className="text-muted">{s.label} →</span> {out.join(', ')}</p> : null })}
      </div>
    </li>
  )
}

function StageIcon({ s }: { s: Stage }) {
  if (s.is_success) return <CheckCircle2 className="h-3.5 w-3.5 text-success" />
  if (s.is_failed) return <XCircle className="h-3.5 w-3.5 text-danger" />
  if (s.is_terminal) return <Flag className="h-3.5 w-3.5 text-muted" />
  if (s.is_initial) return <CircleDot className="h-3.5 w-3.5 text-accent" />
  return <CircleDot className="h-3.5 w-3.5 text-hairline-strong" />
}
