'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Entry {
  id: string
  admin_email: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  before: unknown
  after: unknown
  created_at: string
}

const fmt = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }
const brief = (v: unknown) => { if (v === null || v === undefined) return ''; try { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + '…' : s } catch { return '' } }

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const pageSize = 50
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (search.trim()) p.set('search', search.trim())
      const res = await fetch(`/api/admin/audit?${p}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to load')
      setEntries(j.entries || []); setTotal(j.total || 0)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [page, search])

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  useEffect(() => { setPage(0) }, [search])

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-1">Audit Log</h1>
      <p className="text-sm text-subtle mb-4">{total.toLocaleString()} events · who changed what, when.</p>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search admin, action, business…" className="mb-4 h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-hairline-strong bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-3 py-3 font-medium">Admin</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-3 py-3 font-medium">Target</th>
              <th className="px-3 py-3 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No events.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-b border-hairline last:border-0 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-muted">{fmt(e.created_at)}</td>
                <td className="px-3 py-3 text-ink">{e.admin_email}</td>
                <td className="px-3 py-3"><span className="rounded bg-sunken px-1.5 py-0.5 text-xs font-medium text-ink">{e.action}</span></td>
                <td className="px-3 py-3 text-muted">
                  {e.target_id ? <Link href={`/admin/businesses/${e.target_id}`} className="text-accent-strong hover:underline">{e.target_label || e.target_type || 'view'}</Link> : (e.target_label || '—')}
                </td>
                <td className="px-3 py-3 text-xs text-subtle">
                  {brief(e.before) && <div>from: {brief(e.before)}</div>}
                  {brief(e.after) && <div>to: {brief(e.after)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-subtle">Page {page + 1} of {pages}</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-lg border border-hairline-strong px-3 py-2 disabled:opacity-40">Prev</button>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-hairline-strong px-3 py-2 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
