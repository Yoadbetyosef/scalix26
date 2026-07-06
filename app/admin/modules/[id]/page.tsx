'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MODULES, DEFAULT_ENABLED_MODULES, ALL_MODULES, moduleLabel, type ModuleKey } from '@/lib/modules'
import { useToast } from '@/components/admin/toast'

interface TenantDetail {
  id: string
  business_name: string
  owner_email: string | null
  phone: string | null
  plan: string | null
  status: string
  created_at: string
  enabled_modules: ModuleKey[]
}
interface AuditRow {
  id: string
  changed_by: string
  added: string[]
  removed: string[]
  created_at: string
}

const fmt = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export default function AdminBusinessDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { show, node: toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/modules/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setTenant(data.tenant)
      setAudit(data.audit || [])
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }, [id, show])
  useEffect(() => { load() }, [load])

  async function save(next: ModuleKey[], label: string) {
    if (!tenant) return
    setTenant({ ...tenant, enabled_modules: next }) // optimistic
    setSaving(true)
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, enabled_modules: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      show(label)
      await load() // refresh modules + audit
    } catch (e) {
      show((e as Error).message, 'err')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: ModuleKey) => {
    if (!tenant) return
    const has = tenant.enabled_modules.includes(key)
    save(has ? tenant.enabled_modules.filter((m) => m !== key) : [...tenant.enabled_modules, key], has ? `Disabled ${moduleLabel(key)}` : `Enabled ${moduleLabel(key)}`)
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (!tenant) return <p className="text-sm text-muted">Business not found. <Link href="/admin/modules" className="text-accent-strong hover:underline">Back</Link></p>

  return (
    <div className="max-w-3xl">
      {toast}
      <Link href="/admin/modules" className="text-sm text-subtle hover:text-ink">← All businesses</Link>

      {/* Business header */}
      <div className="mt-3 bg-white rounded-xl border border-hairline-strong p-5">
        <h1 className="text-xl font-bold text-ink">{tenant.business_name || 'Untitled'}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs uppercase tracking-wide text-subtle">Owner</dt><dd className="text-ink truncate">{tenant.owner_email || '—'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-subtle">Plan</dt><dd className="text-ink capitalize">{tenant.plan || '—'}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-subtle">Status</dt><dd className="text-ink capitalize">{tenant.status}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-subtle">Created</dt><dd className="text-ink">{fmt(tenant.created_at)}</dd></div>
        </dl>
      </div>

      {/* Modules */}
      <div className="mt-4 bg-white rounded-xl border border-hairline-strong p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-ink">Modules {saving && <span className="text-xs text-accent-strong font-normal">saving…</span>}</h2>
          <div className="flex gap-2">
            <button onClick={() => save([...ALL_MODULES], 'All modules enabled')} className="rounded-lg border border-hairline-strong px-3 h-9 text-xs font-medium text-ink hover:bg-sunken">Enable all</button>
            <button onClick={() => save([...DEFAULT_ENABLED_MODULES], 'Optional modules disabled')} className="rounded-lg border border-hairline-strong px-3 h-9 text-xs font-medium text-ink hover:bg-sunken">Disable optional</button>
          </div>
        </div>
        <div className="divide-y divide-hairline">
          {MODULES.map((m) => {
            const on = tenant.enabled_modules.includes(m.key)
            return (
              <div key={m.key} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-ink">{m.label}</div>
                  <div className="text-xs text-subtle">{m.description}</div>
                </div>
                <button
                  onClick={() => toggle(m.key)}
                  role="switch"
                  aria-checked={on}
                  aria-label={m.label}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-accent' : 'bg-hairline-strong'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Audit log */}
      <div className="mt-4 bg-white rounded-xl border border-hairline-strong p-5">
        <h2 className="font-semibold text-ink mb-3">Change history</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">No changes yet.</p>
        ) : (
          <ul className="space-y-3">
            {audit.map((a) => (
              <li key={a.id} className="text-sm border-l-2 border-hairline pl-3">
                <div className="text-ink">
                  {a.added.length > 0 && <span className="text-emerald-600">+{a.added.map((m) => moduleLabel(m as ModuleKey)).join(', ')} </span>}
                  {a.removed.length > 0 && <span className="text-red-600">−{a.removed.map((m) => moduleLabel(m as ModuleKey)).join(', ')}</span>}
                </div>
                <div className="text-xs text-subtle">{a.changed_by} · {fmt(a.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
