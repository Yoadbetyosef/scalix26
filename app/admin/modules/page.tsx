'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MODULES, DEFAULT_ENABLED_MODULES, ALL_MODULES, type ModuleKey } from '@/lib/modules'
import { useToast } from '@/components/admin/toast'

interface TenantRow {
  id: string
  business_name: string
  owner_email: string | null
  plan: string | null
  status: string
  created_at: string
  enabled_modules: ModuleKey[]
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '—' }
}

export default function AdminModulesPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const { show, node: toast } = useToast()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setTenants(data.tenants || [])
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(tenant: TenantRow, next: ModuleKey[], label: string) {
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, enabled_modules: next } : t)))
    setSaving(tenant.id)
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, enabled_modules: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, enabled_modules: data.enabled_modules } : t)))
      show(`${tenant.business_name || 'Business'}: ${label}`)
    } catch (e) {
      show((e as Error).message, 'err')
      await load()
    } finally {
      setSaving(null)
    }
  }

  const toggle = (t: TenantRow, key: ModuleKey) => {
    const has = t.enabled_modules.includes(key)
    save(t, has ? t.enabled_modules.filter((m) => m !== key) : [...t.enabled_modules, key], has ? `disabled ${key}` : `enabled ${key}`)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(
      (t) => (t.business_name || '').toLowerCase().includes(q) || (t.owner_email || '').toLowerCase().includes(q),
    )
  }, [tenants, search])

  return (
    <div>
      {toast}
      <h1 className="text-2xl font-bold text-ink mb-1">Modules</h1>
      <p className="text-sm text-subtle mb-6">Turn product modules on or off per business. Changes save immediately and are logged.</p>

      <div className="bg-white rounded-xl border border-hairline-strong p-4 mb-4">
        <input
          className="border border-hairline-strong rounded-lg px-3 h-11 text-sm w-full outline-none focus:border-accent"
          placeholder="Search by business name or owner email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-hairline-strong overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Created</th>
                {MODULES.map((m) => (
                  <th key={m.key} className="px-2 py-3 font-medium text-center whitespace-nowrap" title={m.description}>{m.label}</th>
                ))}
                <th className="px-3 py-3 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-hairline last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{t.business_name || 'Untitled'}</div>
                    <div className="text-xs text-subtle">{t.owner_email || '—'}</div>
                    {saving === t.id && <div className="text-xs text-accent-strong">saving…</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="capitalize text-ink">{t.plan || '—'}</span>
                    <div className="text-xs text-subtle capitalize">{t.status}</div>
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap">{fmtDate(t.created_at)}</td>
                  {MODULES.map((m) => {
                    const on = t.enabled_modules.includes(m.key)
                    return (
                      <td key={m.key} className="px-2 py-3 text-center">
                        <button
                          onClick={() => toggle(t, m.key)}
                          role="switch"
                          aria-checked={on}
                          aria-label={`${m.label} for ${t.business_name}`}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-accent' : 'bg-hairline-strong'}`}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <Link href={`/admin/modules/${t.id}`} className="text-accent-strong hover:underline text-xs font-medium">Open</Link>
                      <button onClick={() => save(t, [...ALL_MODULES], 'all modules enabled')} className="text-xs text-subtle hover:text-ink">Enable all</button>
                      <button onClick={() => save(t, [...DEFAULT_ENABLED_MODULES], 'optional modules disabled')} className="text-xs text-subtle hover:text-ink">Only core</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={MODULES.length + 4} className="px-4 py-8 text-center text-sm text-muted">No businesses found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
