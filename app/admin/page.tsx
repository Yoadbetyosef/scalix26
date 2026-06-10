'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface User {
  id: string
  business_name: string
  auth_email: string
  phone: string
  plan: string
  created_at: string
  subscription_status: string
  last_sign_in: string
}

interface Stats {
  total: number
  trials: number
  paid: number
  mrr: number
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (planFilter) params.set('plan', planFilter)
    const res = await fetch(`/api/admin/users?${params}`)
    const data = await res.json()
    setUsers(data.users || [])
    setStats(data.stats || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [search, planFilter])

  const planColor: Record<string, string> = {
    trial: 'bg-yellow-100 text-yellow-800',
    starter: 'bg-blue-100 text-blue-800',
    pro: 'bg-purple-100 text-purple-800',
    business: 'bg-green-100 text-green-800',
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Users', value: stats.total },
            { label: 'Trial Users', value: stats.trials },
            { label: 'Paid Users', value: stats.paid },
            { label: 'MRR', value: `$${stats.mrr.toLocaleString()}` },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <input
          className="border border-gray-200 rounded-lg px-3 h-11 text-sm flex-1 outline-none focus:border-teal-400"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-200 rounded-lg px-3 h-11 text-sm outline-none focus:border-teal-400"
          value={planFilter}
          onChange={e => setPlanFilter(e.target.value)}
        >
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="business">Business</option>
        </select>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Business', 'Email', 'Phone', 'Plan', 'Signed up', 'Last seen', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
            ) : users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{user.business_name}</td>
                <td className="px-4 py-3 text-gray-600">{user.auth_email}</td>
                <td className="px-4 py-3 text-gray-600">{user.phone || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${planColor[user.plan] || 'bg-gray-100 text-gray-700'}`}>
                    {user.plan}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{new Date(user.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-600">{user.last_sign_in ? new Date(user.last_sign_in).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${user.id}`} className="text-teal-600 hover:underline font-medium">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
