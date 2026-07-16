'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Loc = { id: string; name: string }
type POItem = { id: string; description_snapshot: string | null; quantity: number; received_quantity: number }

export function PoActions({ poId, status, approvalRequired, emailStatus, locations, items }: {
  poId: string; status: string; approvalRequired: string; emailStatus: string; locations: Loc[]; items: POItem[]
}) {
  const router = useRouter()
  const [locId, setLocId] = useState(locations[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [recv, setRecv] = useState<Record<string, string>>({})
  const [dmg, setDmg] = useState<Record<string, string>>({})

  const sendable = approvalRequired === 'none' ? status === 'draft' : status === 'approved'
  const canApprove = status === 'awaiting_approval'
  const canReceive = ['sent_to_supplier', 'supplier_confirmed', 'in_production', 'in_transit', 'partially_received', 'ready_to_ship'].includes(status)

  const call = async (path: string, body?: unknown) => {
    setBusy(true); setMsg(null)
    try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.error || j.detail || 'Failed'); router.refresh(); return j }
    catch (e) { setMsg((e as Error).message); return null } finally { setBusy(false) }
  }

  const reject = async () => {
    const reason = window.prompt('Reason for rejecting this PO? (optional)') ?? ''
    if (reason === null) return
    const j = await call(`/api/commerce/purchase-orders/${poId}/reject`, { reason })
    if (j?.ok) setMsg('Rejected')
  }

  const receive = async () => {
    if (!locId) { setMsg('Choose a receiving location.'); return }
    const lines = items
      .map((i) => ({ poItemId: i.id, accepted: Math.max(0, Number(recv[i.id] || 0)), damaged: Math.max(0, Number(dmg[i.id] || 0)) }))
      .filter((l) => l.accepted > 0 || l.damaged > 0)
    if (!lines.length) { setMsg('Enter at least one accepted or damaged quantity.'); return }
    const j = await call(`/api/commerce/purchase-orders/${poId}/receive`, { locationId: locId, lines, idempotencyKey: `recv:${poId}:${lines.map((l) => `${l.poItemId}:${l.accepted}:${l.damaged}`).join(',')}` })
    if (j?.ok) { setMsg('Received ✓'); setRecv({}); setDmg({}) }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canApprove && <button onClick={() => call(`/api/commerce/purchase-orders/${poId}/approve`)} disabled={busy} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Approve</button>}
        {canApprove && <button onClick={reject} disabled={busy} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">Reject</button>}
        {sendable && <button onClick={() => call(`/api/commerce/purchase-orders/${poId}/send`, { locationId: locId })} disabled={busy || !locId} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Send to Factory</button>}
        {!sendable && approvalRequired !== 'none' && status !== 'sent_to_supplier' && !canApprove && <span className="text-xs text-amber-700">Needs {approvalRequired} approval before sending.</span>}
        {emailStatus === 'failed' && sendable && <span className="text-xs text-red-600">Last email failed — retry above.</span>}
        <select value={locId} onChange={(e) => setLocId(e.target.value)} className="ml-auto rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {locations.length === 0 ? <option value="">— add a location —</option> : locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {canReceive && (
        <div className="border-t border-gray-100 pt-3">
          <div className="mb-1 text-sm font-semibold text-gray-900">Receive goods</div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-400">
            <span className="flex-1">Item</span><span className="w-20 text-right">Accepted</span><span className="w-20 text-right">Damaged</span>
          </div>
          <ul className="space-y-1">
            {items.map((i) => {
              const outstanding = Number(i.quantity) - Number(i.received_quantity)
              return (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-gray-800">{i.description_snapshot || 'Item'}<span className="ml-2 text-xs text-gray-400">{i.received_quantity}/{i.quantity} received</span></span>
                  <input type="number" min={0} max={outstanding} value={recv[i.id] ?? ''} onChange={(e) => setRecv((m) => ({ ...m, [i.id]: e.target.value }))} placeholder={`≤${outstanding}`} disabled={outstanding <= 0} className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                  <input type="number" min={0} max={outstanding} value={dmg[i.id] ?? ''} onChange={(e) => setDmg((m) => ({ ...m, [i.id]: e.target.value }))} placeholder="0" disabled={outstanding <= 0} className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-[11px] text-gray-400">Damaged units are logged and clear from expected incoming stock, but are not added to on-hand and do not count as received (the line stays open for a replacement).</p>
          <button onClick={receive} disabled={busy} className="mt-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Receive</button>
        </div>
      )}
      {msg && <div className="mt-2 text-xs text-gray-600">{msg}</div>}
    </div>
  )
}
