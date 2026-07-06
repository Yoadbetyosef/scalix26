'use client'

import { useEffect, useMemo, useState } from 'react'
import { MODULES, type ModuleKey } from '@/lib/modules'

interface TenantRow {
  id: string
  business_name: string
  plan: string | null
  enabled_modules: ModuleKey[]
}

export default function AdminModulesPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setTenants(data.tenants || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function toggle(tenant: TenantRow, key: ModuleKey) {
    const has = tenant.enabled_modules.includes(key)
    const next = has ? tenant.enabled_modules.filter((m) => m !== key) : [...tenant.enabled_modules, key]
    // Optimistic update
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, enabled_modules: next } : t)))
    setSaving(tenant.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, enabled_modules: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      // Reconcile with the server's sanitised value
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, enabled_modules: data.enabled_modules } : t)))
    } catch (e) {
      setError((e as Error).message)
      await load() // revert to server truth
    } finally {
      setSaving(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter((t) => (t.business_name || '').toLowerCase().includes(q))
  }, [tenants, search])

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-1">Modules</h1>
      <p className="text-sm text-subtle mb-6">Turn product modules on or off per business. Changes apply immediately.</p>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-hairline-strong p-4 mb-4">
        <input
          className="border border-hairline-strong rounded-lg px-3 h-11 text-sm w-full outline-none focus:border-accent"
          placeholder="Search by business name…"
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
                {MODULES.map((m) => (
                  <th key={m.key} className="px-3 py-3 font-medium text-center whitespace-nowrap" title={m.description}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{t.business_name || 'Untitled'}</div>
                    <div className="text-xs text-subtle flex items-center gap-2">
                      <span>{t.plan || '—'}</span>
                      {saving === t.id && <span className="text-accent-strong">saving…</span>}
                    </div>
                  </td>
                  {MODULES.map((m) => {
                    const on = t.enabled_modules.includes(m.key)
                    return (
                      <td key={m.key} className="px-3 py-3 text-center">
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
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={MODULES.length + 1} className="px-4 py-8 text-center text-sm text-muted">No businesses found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
