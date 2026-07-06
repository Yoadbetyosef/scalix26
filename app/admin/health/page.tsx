'use client'

import { useCallback, useEffect, useState } from 'react'

type Status = 'operational' | 'degraded' | 'down' | 'not_configured'
interface Check { service: string; status: Status; ms: number | null; detail?: string }

const meta: Record<Status, { label: string; dot: string; text: string }> = {
  operational: { label: 'Operational', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', text: 'text-amber-700' },
  down: { label: 'Down', dot: 'bg-red-500', text: 'text-red-700' },
  not_configured: { label: 'Not configured', dot: 'bg-gray-300', text: 'text-subtle' },
}

export default function AdminHealthPage() {
  const [services, setServices] = useState<Check[]>([])
  const [overall, setOverall] = useState<Status>('operational')
  const [checkedAt, setCheckedAt] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/health')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setServices(d.services || []); setOverall(d.overall); setCheckedAt(d.checkedAt)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">System Health</h1>
          <p className="text-sm text-subtle">
            Live status of external dependencies.{checkedAt && ` Checked ${new Date(checkedAt).toLocaleTimeString()}.`}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm font-medium text-ink hover:bg-sunken disabled:opacity-50">
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      <div className={`mb-4 flex items-center gap-2 rounded-xl border p-4 ${overall === 'operational' ? 'border-emerald-200 bg-emerald-50' : overall === 'down' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
        <span className={`h-3 w-3 rounded-full ${meta[overall].dot}`} />
        <span className={`font-semibold ${meta[overall].text}`}>All systems {meta[overall].label.toLowerCase()}</span>
      </div>

      <div className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-white">
        {services.map((s) => (
          <div key={s.service} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${meta[s.status].dot}`} />
              <span className="font-medium text-ink">{s.service}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {s.ms !== null && <span className="text-subtle tabular-nums">{s.ms} ms</span>}
              {s.detail && <span className="text-red-600">{s.detail}</span>}
              <span className={`font-medium ${meta[s.status].text}`}>{meta[s.status].label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
