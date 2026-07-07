'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Panel, EmptyRow } from '@/components/partner/ui'
import { Trash2, UserPlus } from 'lucide-react'

interface Member { id: string; role: string; status: string; email?: string; user_id: string | null }

const ROLES = ['owner', 'manager', 'sales', 'marketing', 'finance', 'support']

export function TeamManager({ canManage }: { canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('sales')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/partner/members')
    const j = await res.json()
    setMembers(j.members || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const res = await fetch('/api/partner/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed to invite')
    toast.success(`Invited ${email}`); setEmail(''); load()
  }

  async function changeRole(id: string, newRole: string) {
    const res = await fetch('/api/partner/members', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: id, role: newRole }) })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    load()
  }
  async function remove(id: string) {
    if (!confirm('Remove this member?')) return
    const res = await fetch(`/api/partner/members?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Removed'); load()
  }

  return (
    <Panel title="Team">
      {canManage && (
        <form onSubmit={invite} className="mb-4 flex flex-wrap gap-2">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com"
            className="h-10 flex-1 min-w-[200px] rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="h-10 rounded-lg border border-hairline-strong px-3 text-sm capitalize outline-none focus:border-accent">
            {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
          </select>
          <button disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">
            <UserPlus className="h-4 w-4" /> Invite
          </button>
        </form>
      )}
      {loading ? <EmptyRow>Loading…</EmptyRow> : members.length === 0 ? <EmptyRow>No team members yet.</EmptyRow> : (
        <div className="divide-y divide-hairline">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm text-ink">{m.email || '—'}</div>
                <div className="text-xs text-muted">{m.status === 'invited' ? 'Invited · pending' : m.status}</div>
              </div>
              {canManage && m.role !== 'owner' ? (
                <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} className="h-8 rounded-lg border border-hairline-strong px-2 text-xs capitalize outline-none focus:border-accent">
                  {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
                </select>
              ) : <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium capitalize text-subtle">{m.role}</span>}
              {canManage && m.role !== 'owner' && (
                <button onClick={() => remove(m.id)} className="text-muted hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
