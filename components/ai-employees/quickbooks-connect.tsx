'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { BookText, Check, Link2Off } from 'lucide-react'

type Status = { connected: boolean; companyName?: string | null; environment?: string; status?: string }

export function QuickbooksConnect({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const qb = p.get('qb')
    if (qb === 'connected') toast.success('QuickBooks connected!')
    else if (qb === 'denied') toast.error('QuickBooks connection was cancelled.')
    else if (qb === 'not_configured') toast.error('QuickBooks isn’t enabled on this account yet. Please contact support.')
    else if (qb === 'error') toast.error('Could not connect QuickBooks. Please try again.')
    let on = true
    fetch('/api/commerce/quickbooks/status')
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d) => { if (on) setStatus(d) })
      .catch(() => { if (on) setStatus({ connected: false }) })
    return () => { on = false }
  }, [])

  async function disconnect() {
    if (!confirm('Disconnect QuickBooks?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/commerce/quickbooks/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error()
      setStatus({ connected: false })
      toast.success('QuickBooks disconnected')
    } catch {
      toast.error('Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <BookText className="w-4 h-4 text-gray-600" />
        <span className="font-semibold text-gray-800 text-sm">Accounting (QuickBooks)</span>
        {status?.connected && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" /> Connected
          </span>
        )}
      </div>

      {status === null ? (
        <p className="text-xs text-gray-400 mt-2">Checking…</p>
      ) : !status.connected ? (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-3">Connect your QuickBooks Online account to link your accounting. Optional.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = `/api/commerce/quickbooks/connect?agentId=${encodeURIComponent(agentId)}` }}>
            Connect QuickBooks
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-gray-500">
            QuickBooks Online is connected{status.companyName ? <> · <span className="text-gray-700">{status.companyName}</span></> : null}{status.environment ? <> · {status.environment}</> : null}.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            <Link2Off className="w-3.5 h-3.5 mr-1.5" /> Disconnect
          </Button>
        </div>
      )}
    </div>
  )
}
