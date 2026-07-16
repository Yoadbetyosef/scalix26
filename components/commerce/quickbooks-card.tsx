'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { QboStatus } from '@/lib/commerce/quickbooks/connection'

export function QuickBooksCard({ configured, status }: { configured: boolean; status: QboStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const post = async (path: string) => {
    setBusy(path); setMsg(null)
    try {
      const r = await fetch(path, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Failed')
      return j
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); return null } finally { setBusy(null) }
  }

  const test = async () => { const j = await post('/api/commerce/quickbooks/test'); if (j?.ok) { setMsg({ text: `Connected to ${j.companyName || 'QuickBooks'} ✓`, ok: true }); router.refresh() } }
  const disconnect = async () => { if (!window.confirm('Disconnect QuickBooks? Syncing will stop until you reconnect.')) return; const j = await post('/api/commerce/quickbooks/disconnect'); if (j?.ok) router.refresh() }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2CA01C] text-lg font-bold text-white">qb</div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">QuickBooks Online</h2>
            {status.connected && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Connected</span>}
            {status.status === 'error' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">Needs attention</span>}
            {status.connected && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{status.environment}</span>}
          </div>
          <p className="mt-1 text-sm text-gray-500">Sync your suppliers and purchase orders to QuickBooks so your books stay in step with what you order.</p>

          {status.connected ? (
            <div className="mt-3 space-y-1 text-sm text-gray-700">
              {status.companyName && <div>Company: <span className="font-medium">{status.companyName}</span></div>}
              {status.lastSyncedAt && <div className="text-xs text-gray-400">Last checked {new Date(status.lastSyncedAt).toLocaleString()}</div>}
            </div>
          ) : status.status === 'error' ? (
            <div className="mt-3 text-sm text-red-600">Connection error{status.lastError ? `: ${status.lastError}` : ''}. Reconnect to restore syncing.</div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {status.connected ? (
              <>
                <button onClick={test} disabled={!!busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40">{busy?.endsWith('test') ? 'Testing…' : 'Test connection'}</button>
                <button onClick={disconnect} disabled={!!busy} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">Disconnect</button>
              </>
            ) : configured ? (
              <a href="/api/commerce/quickbooks/connect" className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800">Connect QuickBooks</a>
            ) : (
              <span className="text-sm text-gray-400">Not available on this environment yet.</span>
            )}
          </div>
          {msg && <div className={`mt-2 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</div>}
        </div>
      </div>
    </div>
  )
}
