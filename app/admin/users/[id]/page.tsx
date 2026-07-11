'use client'

import { useEffect, useState, use } from 'react'
import { toast } from 'sonner'

interface UserDetail {
  tenant: Record<string, unknown>
  authUser: { email: string; last_sign_in_at: string } | null
  employees: { id: string; name: string; status: string }[]
  channels: { type: string; status: string; twilio_number: string }[]
  conversations: { id: string; status: string; created_at: string }[]
}

export default function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState('')

  useEffect(() => {
    fetch(`/api/admin/users/${id}`).then(r => r.json()).then(d => {
      setData(d)
      setPlan(d.tenant?.plan || 'trial')
      setLoading(false)
    })
  }, [id])

  async function updatePlan() {
    setSaving(true)
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
    setSaving(false)
    if (res.ok) toast.success('Plan updated')
    else toast.error('Failed to update plan')
  }

  async function action(act: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act }),
    })
    const json = await res.json()
    if (act === 'impersonate' && json.url) {
      window.open(json.url, '_blank')
    } else if (res.ok) {
      toast.success(json.message || 'Done')
    } else {
      toast.error(json.error || 'Error')
    }
  }

  if (loading) return <div className="p-8 text-muted">Loading...</div>
  if (!data) return <div className="p-8 text-red-500">User not found</div>

  const t = data.tenant as Record<string, string>

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <a href="/admin" className="tap-target inline-block py-3 -my-3 text-muted hover:text-subtle text-sm">← Back</a>
        <h1 className="text-2xl font-bold text-ink min-w-0">{t.business_name}</h1>
        <span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded-full text-xs font-medium flex-shrink-0">{t.plan}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Account Info */}
        <div className="bg-white rounded-xl border border-hairline-strong p-5">
          <h2 className="font-semibold text-ink mb-4">Account Info</h2>
          {[
            ['Email', data.authUser?.email || t.email],
            ['Phone', t.phone || '—'],
            ['Industry', t.industry || '—'],
            ['Website', t.website || '—'],
            ['Signed up', new Date(t.created_at).toLocaleString()],
            ['Last login', data.authUser?.last_sign_in_at ? new Date(data.authUser.last_sign_in_at).toLocaleString() : '—'],
            ['Stripe Customer', t.stripe_customer_id || '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 py-1.5 text-sm border-b border-gray-50 last:border-0">
              <span className="text-subtle flex-shrink-0">{k}</span>
              <span className="text-ink font-medium min-w-0 truncate text-right">{v}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl border border-hairline-strong p-5">
          <h2 className="font-semibold text-ink mb-4">Actions</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-subtle uppercase font-medium">Change Plan</label>
              <div className="flex gap-2 mt-1">
                <select
                  className="border border-hairline-strong rounded-lg px-3 h-11 text-sm flex-1 outline-none"
                  value={plan} onChange={e => setPlan(e.target.value)}
                >
                  {['trial', 'starter', 'pro', 'business'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button
                  onClick={updatePlan} disabled={saving}
                  className="px-4 py-3 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-50"
                >
                  {saving ? '...' : 'Save'}
                </button>
              </div>
            </div>

            <button onClick={() => action('reset_password')}
              className="w-full px-4 py-3 border border-hairline-strong rounded-lg text-sm hover:bg-sunken text-left">
              Send Password Reset Email
            </button>

            <button onClick={() => action('impersonate')}
              className="w-full px-4 py-3 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 text-left">
              Login as this user (impersonate)
            </button>

            <a href={`/api/admin/users/${id}/export`}
              className="tap-target block w-full px-4 py-3 border border-hairline-strong rounded-lg text-sm hover:bg-sunken text-center">
              Export data as CSV
            </a>
          </div>
        </div>

        {/* Channels */}
        <div className="bg-white rounded-xl border border-hairline-strong p-5">
          <h2 className="font-semibold text-ink mb-4">Channels</h2>
          {data.channels?.length === 0 ? <p className="text-sm text-muted">No channels</p> :
            data.channels?.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
                <span className="text-ink capitalize">{c.type}</span>
                <div className="flex items-center gap-2">
                  {c.twilio_number && <span className="text-muted text-xs">{c.twilio_number}</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-sunken text-subtle'}`}>{c.status}</span>
                </div>
              </div>
            ))}
        </div>

        {/* AI Employees */}
        <div className="bg-white rounded-xl border border-hairline-strong p-5">
          <h2 className="font-semibold text-ink mb-4">AI Employees</h2>
          {data.employees?.length === 0 ? <p className="text-sm text-muted">None</p> :
            data.employees?.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm border-b border-gray-50 last:border-0">
                <span className="text-ink min-w-0 truncate">{e.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ${e.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-sunken text-subtle'}`}>{e.status}</span>
              </div>
            ))}
        </div>

        {/* Recent conversations */}
        <div className="col-span-1 lg:col-span-2 bg-white rounded-xl border border-hairline-strong p-5">
          <h2 className="font-semibold text-ink mb-4">Recent Conversations ({data.conversations?.length || 0})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-subtle uppercase border-b border-hairline">
                  <th className="pb-2 text-left">ID</th>
                  <th className="pb-2 text-left">Status</th>
                  <th className="pb-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.conversations?.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-subtle">{c.id.slice(0, 8)}...</td>
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-sunken text-subtle'}`}>{c.status}</span>
                    </td>
                    <td className="py-1.5 text-subtle">{new Date(c.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {data.conversations?.length === 0 && <tr><td colSpan={3} className="py-4 text-muted text-center">No conversations</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
