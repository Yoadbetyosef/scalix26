'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/admin/toast'

interface Member { id: string; email: string; role: string; created_at: string }
interface RoleDef { key: string; label: string }

export default function AdminTeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [me, setMe] = useState('')
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('support')
  const [busy, setBusy] = useState(false)
  const { show, node: toast } = useToast()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/team')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setMembers(d.members || []); setRoles(d.roles || []); setMe(d.me || '')
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function upsert(e: string, r: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, role: r }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      show('Saved'); setEmail(''); load()
    } catch (err) { show((err as Error).message, 'err') } finally { setBusy(false) }
  }

  async function remove(e: string) {
    if (!confirm(`Remove ${e} from the admin team?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/team?email=${encodeURIComponent(e)}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      show('Removed'); load()
    } catch (err) { show((err as Error).message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl">
      {toast}
      <h1 className="text-2xl font-bold text-ink mb-1">Team & Permissions</h1>
      <p className="text-sm text-subtle mb-6">Who can access the admin platform, and what they can do. Super Admin only.</p>

      <div className="mb-4 rounded-xl border border-hairline-strong bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" className="h-11 flex-1 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent">
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button onClick={() => upsert(email, role)} disabled={busy || !email} className="h-11 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">Add / update</button>
        </div>
        <p className="mt-2 text-xs text-subtle">Members must sign in with this email. Note: they also need to be able to sign in to the app (Supabase account).</p>
      </div>

      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <div className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-white">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium text-ink">{m.email}{m.email === me && <span className="ml-2 text-xs text-subtle">(you)</span>}</div>
                <div className="text-xs text-subtle">Added {new Date(m.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-2">
                <select value={m.role} onChange={(e) => upsert(m.email, e.target.value)} disabled={busy} className="h-9 rounded-lg border border-hairline-strong px-2 text-sm">
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <button onClick={() => remove(m.email)} disabled={busy || m.email === me} className="rounded-lg border border-hairline-strong px-3 py-2 text-sm text-red-600 hover:bg-sunken disabled:opacity-40">Remove</button>
              </div>
            </div>
          ))}
          {members.length === 0 && <div className="p-6 text-center text-sm text-muted">No team members yet.</div>}
        </div>
      )}
    </div>
  )
}
