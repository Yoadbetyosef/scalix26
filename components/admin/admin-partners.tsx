'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'

interface Partner {
  id: string; company_name: string | null; slug: string; partner_type: string; status: string; tier: number
  health_score: number | null; contact_email: string; stats: { customers: number; pending: number; paid: number }
}

const money = (c: number) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

export function AdminPartners({ canWrite }: { canWrite: boolean }) {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/partners'); const j = await res.json()
    setPartners(j.partners || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function setStatus(id: string, status: string) {
    const res = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!res.ok) return toast.error('Failed'); load()
  }
  async function commission(partnerId: string, action: 'approve' | 'pay') {
    const res = await fetch('/api/admin/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerId, action }) })
    const j = await res.json()
    if (!res.ok) return toast.error(j.error || 'Failed')
    toast.success(action === 'pay' ? `Paid ${money(j.amount_cents)}` : 'Approved pending commissions'); load()
  }

  if (loading) return <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading…</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="px-3 py-2 font-medium">Partner</th><th className="px-3 py-2 font-medium">Type</th>
          <th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium text-right">Customers</th>
          <th className="px-3 py-2 font-medium text-right">Owed</th><th className="px-3 py-2 font-medium text-right">Paid</th>
          {canWrite && <th className="px-3 py-2 font-medium">Actions</th>}
        </tr></thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-b border-gray-100">
              <td className="px-3 py-2.5">
                <div className="font-medium text-gray-900">{p.company_name || p.slug}</div>
                <div className="text-xs text-gray-400">{p.contact_email}</div>
              </td>
              <td className="px-3 py-2.5 capitalize text-gray-600">{p.partner_type}</td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'active' ? 'bg-green-50 text-green-700' : p.status === 'suspended' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{p.status}</span>
              </td>
              <td className="px-3 py-2.5 text-right text-gray-700">{p.stats.customers}</td>
              <td className="px-3 py-2.5 text-right font-medium text-gray-900">{money(p.stats.pending)}</td>
              <td className="px-3 py-2.5 text-right text-gray-600">{money(p.stats.paid)}</td>
              {canWrite && (
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => commission(p.id, 'approve')} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Approve</button>
                    <button onClick={() => commission(p.id, 'pay')} className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white">Pay out</button>
                    {p.status === 'active'
                      ? <button onClick={() => setStatus(p.id, 'suspended')} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Suspend</button>
                      : <button onClick={() => setStatus(p.id, 'active')} className="rounded border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50">Activate</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {partners.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No partners yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
