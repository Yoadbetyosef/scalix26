'use client'

import { Fragment, useEffect, useState } from 'react'

interface Job {
  id: string; tenant_id: string; business_name: string; source: string; phase: string; status: string
  max_cost: number; records_scanned: number; records_skipped: number; records_deduplicated: number; samples_selected: number
  patterns_known: number; patterns_similar: number; patterns_novel: number; patterns_deferred: number; cost_saved: number
  llm_calls: number; estimated_tokens: number; actual_tokens: number; estimated_cost: number; actual_cost: number
  estimated_duration_ms: number; duration_ms: number; hard_stopped_reason: string | null; optimization_notes: string[] | null; created_at: string
}
interface TenantRoll { tenant_id: string; business_name: string; jobs: number; lifetime_cost: number; lifetime_saved: number; llm_calls: number; last_run: string | null }
interface Limits { initialCapUSD: number; incrementalCapUSD: number; cronEnabled: boolean; enabled: boolean; historyMonths: number }

const money = (n: number) => `$${(Number(n) || 0).toFixed(4)}`
const dur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms || 0}ms`)
const badge = (status: string) => {
  const c: Record<string, string> = { completed: 'bg-emerald-100 text-emerald-700', paused: 'bg-amber-100 text-amber-700', running: 'bg-blue-100 text-blue-700', error: 'bg-red-100 text-red-700' }
  return c[status] || 'bg-gray-100 text-gray-600'
}

export default function AdminLearningPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [tenants, setTenants] = useState<TenantRoll[]>([])
  const [limits, setLimits] = useState<Limits | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/learning').then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error)
      setJobs(d.jobs || []); setTenants(d.tenants || []); setLimits(d.limits || null)
    }).catch(() => setErr('failed to load')).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink">Learning Cost Simulator</h1>
        <p className="text-sm text-muted">Exactly what each customer&apos;s AI learning costs us. Admin only — customers never see this.</p>
      </div>

      {limits && (
        <div className="flex flex-wrap gap-3 text-sm">
          <Chip label="Initial cap" value={`$${limits.initialCapUSD}`} />
          <Chip label="Incremental cap" value={`$${limits.incrementalCapUSD}`} />
          <Chip label="History" value={`${limits.historyMonths} mo`} />
          <Chip label="Learning" value={limits.enabled ? 'ON' : 'OFF'} tone={limits.enabled ? 'good' : 'bad'} />
          <Chip label="Cron" value={limits.cronEnabled ? 'ENABLED' : 'disabled'} tone={limits.cronEnabled ? 'warn' : 'good'} />
        </div>
      )}

      {loading && <p className="text-muted">Loading…</p>}
      {err && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{err} — run <code>add_learning_jobs.sql</code> to enable full metrics.</p>}

      {!!tenants.length && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Lifetime cost per customer</h2>
          <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr><Th>Business</Th><Th>Jobs</Th><Th>LLM calls</Th><Th>Lifetime cost</Th><Th>Saved</Th><Th>Last run</Th></tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.tenant_id} className="border-t border-hairline">
                    <Td>{t.business_name}</Td><Td>{t.jobs}</Td><Td>{t.llm_calls}</Td>
                    <Td className="font-semibold">{money(t.lifetime_cost)}</Td>
                    <Td className="text-emerald-700">{money(t.lifetime_saved)}</Td>
                    <Td>{t.last_run ? new Date(t.last_run).toLocaleString() : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Every learning job</h2>
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full text-xs">
            <thead className="bg-sunken text-left text-muted">
              <tr>
                <Th>When</Th><Th>Business</Th><Th>Phase</Th><Th>Status</Th>
                <Th>Scanned</Th><Th>Deduped</Th><Th>Known</Th><Th>Similar</Th><Th>Novel</Th><Th>Deferred</Th>
                <Th>Calls</Th><Th>Act tok</Th><Th>Est $</Th><Th>Act $</Th><Th>Saved</Th><Th>Cap</Th><Th>Dur</Th><Th>Stop</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr className="border-t border-hairline">
                    <Td>{new Date(j.created_at).toLocaleString()}</Td>
                    <Td>{j.business_name}</Td>
                    <Td>{j.phase}</Td>
                    <Td><span className={`rounded px-1.5 py-0.5 ${badge(j.status)}`}>{j.status}</span></Td>
                    <Td>{j.records_scanned}</Td><Td>{j.records_deduplicated}</Td>
                    <Td className="text-emerald-700">{j.patterns_known}</Td><Td>{j.patterns_similar}</Td><Td className="font-semibold">{j.patterns_novel}</Td><Td className="text-amber-700">{j.patterns_deferred}</Td>
                    <Td>{j.llm_calls}</Td><Td>{j.actual_tokens?.toLocaleString?.() ?? j.actual_tokens}</Td>
                    <Td>{money(j.estimated_cost)}</Td><Td className="font-semibold">{money(j.actual_cost)}</Td><Td className="text-emerald-700">{money(j.cost_saved)}</Td><Td>${j.max_cost}</Td>
                    <Td>{dur(j.duration_ms)}</Td><Td className="text-amber-700">{j.hard_stopped_reason || ''}</Td>
                  </tr>
                  {!!j.optimization_notes?.length && (
                    <tr className="border-t border-hairline/50">
                      <Td className="text-muted">↳</Td>
                      <td colSpan={17} className="px-3 py-1.5 text-[11px] text-muted">
                        {j.optimization_notes.map((n, i) => <span key={i} className="mr-3">• {n}</span>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!jobs.length && !loading && <tr><Td>No learning jobs yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const t = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink'
  return <span className="rounded-lg border border-hairline bg-white px-3 py-1.5"><span className="text-muted">{label}: </span><span className={`font-semibold ${t}`}>{value}</span></span>
}
function Th({ children }: { children: React.ReactNode }) { return <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th> }
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <td className={`whitespace-nowrap px-3 py-2 ${className}`}>{children}</td> }
