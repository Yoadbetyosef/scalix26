'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface Row {
  id: string
  business_name: string
  owner_email: string | null
  phone: string | null
  industry: string | null
  plan: string | null
  status: string
  created_at: string
  last_login: string | null
  agents: number
  channels: number
  revenue: number
  tags: string[]
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trial', label: 'Trial' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'enterprise', label: 'Enterprise' },
]
const fmtDate = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) } catch { return '—' } }
const statusPill: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700', trial: 'bg-amber-50 text-amber-700', suspended: 'bg-red-50 text-red-700',
}

export default function AdminBusinessesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize] = useState(25)
  const initialSearch = useSearchParams().get('search') || ''
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (search.trim()) p.set('search', search.trim())
      if (status) p.set('status', status)
      const res = await fetch(`/api/admin/businesses?${p}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setRows(d.businesses || []); setTotal(d.total || 0)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [page, pageSize, search, status])

  // Debounce search; reset to page 0 on search/filter change.
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  useEffect(() => { setPage(0) }, [search, status])

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Businesses</h1>
          <p className="text-sm text-subtle">{total.toLocaleString()} total</p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="h-11 flex-1 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent"
          placeholder="Search name, email, phone, industry…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${status === f.key ? 'bg-ink text-white' : 'bg-white text-subtle border border-hairline-strong hover:text-ink'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-hairline-strong bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-3 py-3 font-medium">Industry</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium text-right">Agents</th>
              <th className="px-3 py-3 font-medium text-right">Channels</th>
              <th className="px-3 py-3 font-medium text-right">Revenue</th>
              <th className="px-3 py-3 font-medium">Created</th>
              <th className="px-3 py-3 font-medium">Last login</th>
              <th className="px-3 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted">No businesses found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-sunken/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/businesses/${r.id}`} className="font-medium text-ink hover:underline">{r.business_name || 'Untitled'}</Link>
                  <div className="text-xs text-subtle">{r.owner_email || '—'}</div>
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tags.map((t) => <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">{t}</span>)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-muted">{r.industry || '—'}</td>
                <td className="px-3 py-3 capitalize text-ink">{r.plan || '—'}</td>
                <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusPill[r.status] || 'bg-sunken text-subtle'}`}>{r.status}</span></td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{r.agents}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{r.channels}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">${r.revenue.toLocaleString()}</td>
                <td className="px-3 py-3 whitespace-nowrap text-muted">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-muted">{fmtDate(r.last_login)}</td>
                <td className="px-3 py-3 text-right"><Link href={`/admin/businesses/${r.id}`} className="text-xs font-medium text-accent-strong hover:underline">Manage</Link></td>
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
