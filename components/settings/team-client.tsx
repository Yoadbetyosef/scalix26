'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Mail, UserMinus, UserPlus } from 'lucide-react'
import { GlassInput } from '@/app/(v2)/v2/controls'
import { ASSIGNABLE_ROLES, TEAM_ROLES, type TeamRole } from '@/lib/team/roles'
import type { TeamMember } from '@/lib/team/members'

// The Team screen. Small on purpose — this is "who can log in", not a permissions product.
//
// Every mutation goes to /api/team*, which re-derives the caller's business and capability server-side;
// nothing here is trusted, and the buttons this file declines to render are refused there anyway.

const roleLabel = (r: TeamRole) => TEAM_ROLES.find((x) => x.key === r)?.label ?? r

function StatusBadge({ member }: { member: TeamMember }) {
  // "Invited" and "Active" are the same access state — see lib/team/members.ts. The difference the
  // owner actually cares about is whether the person has signed in yet, which is accepted_at.
  const accepted = !!member.acceptedAt
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        accepted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {accepted ? 'Active' : 'Invited'}
    </span>
  )
}

export function TeamClient({
  members,
  businessName,
  currentUserId,
  migrationMissing,
}: {
  members: TeamMember[]
  businessName: string
  currentUserId: string
  migrationMissing: boolean
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<TeamRole>('staff')
  const [busy, setBusy] = useState<string | null>(null)

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy('invite')
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() || null, role }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not add that person.')
        return
      }
      // Reported honestly: the seat is real either way, and if the mail failed the owner needs to
      // know to re-send rather than assume it landed.
      toast[json.emailed ? 'success' : 'warning'](
        json.emailed
          ? `Invitation sent to ${email.trim()}.`
          : `${email.trim()} was added, but the invitation email did not send. Try Re-send.`,
      )
      setEmail('')
      setFullName('')
      router.refresh()
    } catch {
      toast.error('Could not add that person.')
    } finally {
      setBusy(null)
    }
  }

  async function resend(member: TeamMember) {
    setBusy(member.id)
    try {
      // Re-inviting is the same call — inviteMember updates the existing row and mints a fresh link.
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: member.email, fullName: member.fullName, role: member.role }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || 'Could not re-send.'); return }
      toast[json.emailed ? 'success' : 'warning'](json.emailed ? `Invitation re-sent to ${member.email}.` : 'Could not send the email.')
    } catch {
      toast.error('Could not re-send.')
    } finally {
      setBusy(null)
    }
  }

  async function changeRole(member: TeamMember, next: TeamRole) {
    setBusy(member.id)
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      })
      if (!res.ok) { toast.error('Could not change that role.'); return }
      toast.success(`${member.email} is now ${roleLabel(next)}.`)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function remove(member: TeamMember) {
    if (!confirm(`Remove ${member.email} from ${businessName}? They will lose access immediately.`)) return
    setBusy(member.id)
    try {
      const res = await fetch(`/api/team/${member.id}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Could not remove that person.'); return }
      toast.success(`${member.email} no longer has access.`)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800">
        <ArrowLeft className="h-4 w-4" /> Settings
      </Link>

      <h1 className="text-xl font-semibold text-neutral-900">Team</h1>
      <p className="mt-1 text-sm text-neutral-500">
        People who can sign in to {businessName}. Everyone here works on the same customers, orders and
        documents — nothing is duplicated.
      </p>

      {migrationMissing && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Team accounts aren&apos;t enabled yet — the <code>tenant_members</code> migration hasn&apos;t been run
          on this database.
        </div>
      )}

      {/* ── Add somebody ─────────────────────────────────────────────────── */}
      <form onSubmit={invite} className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-800">
          <UserPlus className="h-4 w-4" /> Add a team member
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <GlassInput
            type="email"
            label="Email address"
            value={email}
            onChange={setEmail}
            placeholder="name@business.com"
          />
          <GlassInput
            label="Full name (optional)"
            value={fullName}
            onChange={setFullName}
            placeholder="Jane Smith"
          />
          {/* Same <label>/<span> shape GlassInput renders, so the three fields line up on one baseline. */}
          <label className="v2-field">
            <span className="v2-flab">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
              className="v2-finput"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {TEAM_ROLES.find((r) => r.key === role)?.blurb}
        </p>
        <button
          type="submit"
          disabled={busy === 'invite'}
          className="mt-3 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'invite' ? 'Sending…' : 'Send invitation'}
        </button>
        <p className="mt-2 text-xs text-neutral-400">
          They&apos;ll get an email to choose their own password. You never see or set it.
        </p>
      </form>

      {/* ── Who's here ───────────────────────────────────────────────────── */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {members.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No team members yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {members.map((m) => {
              const isOwner = m.role === 'owner'
              const isSelf = !!m.userId && m.userId === currentUserId
              // Same rule the server enforces in canManageMember: never an owner, never yourself.
              const editable = !isOwner && !isSelf
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-900">
                      {m.fullName || m.email || '—'}
                      {isSelf && <span className="ml-1.5 text-xs font-normal text-neutral-400">(you)</span>}
                    </div>
                    {m.fullName && <div className="truncate text-xs text-neutral-500">{m.email}</div>}
                  </div>

                  <StatusBadge member={m} />

                  {editable ? (
                    <select
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => changeRole(m, e.target.value as TeamRole)}
                      aria-label={`Role for ${m.email}`}
                      className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-neutral-500">{roleLabel(m.role)}</span>
                  )}

                  {editable && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => resend(m)}
                        disabled={busy === m.id}
                        title="Re-send invitation"
                        className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-50"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(m)}
                        disabled={busy === m.id}
                        title="Remove access"
                        className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
