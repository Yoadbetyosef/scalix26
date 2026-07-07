'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Panel, EmptyRow } from '@/components/partner/ui'
import { Copy, Trash2, KeyRound } from 'lucide-react'

interface ApiKey { id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }

export function ApiKeysManager({ canManage }: { canManage: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('read')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/partner/api-keys'); const j = await res.json()
    setKeys(j.keys || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const scopes = scope === 'write' ? ['read', 'write'] : ['read']
    const res = await fetch('/api/partner/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    setFresh(j.key); setName(''); load()
  }
  async function revoke(id: string) {
    if (!confirm('Revoke this key? Apps using it will stop working.')) return
    const res = await fetch(`/api/partner/api-keys?id=${id}`, { method: 'DELETE' })
    if (!res.ok) return toast.error('Failed')
    toast.success('Revoked'); load()
  }

  return (
    <Panel title="API Keys">
      <p className="mb-3 text-sm text-subtle">Programmatic access to your partner data. Keep keys secret; they carry your permissions.</p>
      {fresh && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="mb-1 text-xs font-medium text-accent-strong">Copy your new key now — it won&apos;t be shown again.</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink">{fresh}</code>
            <button onClick={() => { navigator.clipboard.writeText(fresh); toast.success('Copied') }} className="rounded-lg bg-ink p-2 text-white"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {canManage && (
        <form onSubmit={create} className="mb-4 flex flex-wrap gap-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. Zapier)"
            className="h-10 flex-1 min-w-[180px] rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="h-10 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent">
            <option value="read">Read only</option>
            <option value="write">Read & write</option>
          </select>
          <button disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">
            <KeyRound className="h-4 w-4" /> Create
          </button>
        </form>
      )}
      {loading ? <EmptyRow>Loading…</EmptyRow> : keys.length === 0 ? <EmptyRow>No API keys yet.</EmptyRow> : (
        <div className="divide-y divide-hairline">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-ink">{k.name} {k.revoked_at && <span className="text-xs text-red-500">(revoked)</span>}</div>
                <div className="font-mono text-xs text-muted">{k.key_prefix}… · {k.scopes.join(', ')}</div>
              </div>
              {canManage && !k.revoked_at && (
                <button onClick={() => revoke(k.id)} className="text-muted hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
