'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CreditCard, Check, Link2Off } from 'lucide-react'

type Status = { connected: boolean; accountId?: string; email?: string | null; chargesEnabled?: boolean }

export function StripeConnect({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/stripe/connect/status')
      setStatus(res.ok ? await res.json() : { connected: false })
    } catch {
      setStatus({ connected: false })
    }
  }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('stripe_connected')) toast.success('Stripe connected!')
    if (p.get('stripe_error')) toast.error('Could not connect Stripe. Please try again.')
    load()
  }, [])

  async function disconnect() {
    if (!confirm('Disconnect Stripe? The AI will no longer be able to send payment links.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/stripe/connect/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error()
      setStatus({ connected: false })
      toast.success('Stripe disconnected')
    } catch {
      toast.error('Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-gray-600" />
        <span className="font-semibold text-gray-800 text-sm">Payments (Stripe)</span>
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
          <p className="text-xs text-gray-500 mb-3">Connect your Stripe account so the AI can send customers a secure payment link for your products. Money goes directly to your Stripe — we never touch or hold funds. Optional.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = `/api/auth/stripe/connect?agentId=${encodeURIComponent(agentId)}` }}>
            Connect Stripe
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-gray-500">
            The AI can send payment links for your Stripe products{status.email ? <> · <span className="text-gray-700">{status.email}</span></> : null}.
            {status.chargesEnabled === false && <span className="text-amber-600"> Your Stripe account can&apos;t accept charges yet — finish setup in Stripe.</span>}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            <Link2Off className="w-3.5 h-3.5 mr-1.5" /> Disconnect
          </Button>
        </div>
      )}
    </div>
  )
}
