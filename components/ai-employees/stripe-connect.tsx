'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatusPill } from '@/app/(v2)/v2/controls'
import { useConfirm } from '@/components/v2/confirm'
import { CreditCard, Link2Off } from 'lucide-react'

type Status = { connected: boolean; accountId?: string; email?: string | null; chargesEnabled?: boolean; payoutsEnabled?: boolean; onboardingComplete?: boolean }

export function StripeConnect({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useConfirm()

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('stripe_connected')) toast.success('Stripe connected!')
    const err = p.get('stripe_error')
    if (err === 'not_configured') toast.error('Stripe payments aren’t enabled on this account yet. Please contact support.')
    else if (err) toast.error('Could not connect Stripe. Please try again.')
    let on = true
    fetch('/api/stripe/connect/status')
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d) => { if (on) setStatus(d) })
      .catch(() => { if (on) setStatus({ connected: false }) })
    return () => { on = false }
  }, [])

  async function disconnect() {
    if (!(await ask({
      title: 'Disconnect Stripe',
      body: <>The AI will no longer be able to send customers a payment link. Your Stripe account and its history are untouched, and you can connect it again at any time.</>,
      confirmLabel: 'Disconnect Stripe',
      danger: true,
    }))) return
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
    <div style={{ marginTop: 18 }}>
      {dialog}
      <div className="v2-grow" data-static>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><CreditCard /></span>
        <span className="v2-glab">
          <b style={{ fontWeight: 550 }}>Payments (Stripe)</b>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
            {status === null
              ? 'Checking…'
              : !status.connected
                ? 'Connect your Stripe account so the AI can send customers a secure payment link for your products. Money goes directly to your Stripe — we never touch or hold funds. Optional.'
                : <>The AI can send payment links for your Stripe products{status.email ? ` · ${status.email}` : ''}.</>}
          </span>
          {status?.connected && (status.chargesEnabled === false || status.onboardingComplete === false) && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, color: 'var(--v2-hold-ink)' }}>
              Your Stripe account cannot accept charges yet — finish setup in Stripe to go live.
            </span>
          )}
        </span>
        <span className="v2-gtrail">
          {status === null ? null : <StatusPill state={status.connected ? 'live' : 'off'}>{status.connected ? 'Connected' : 'Not connected'}</StatusPill>}
        </span>
      </div>

      {status !== null && (
        <div className="v2-bar" style={{ marginTop: 12 }}>
          {!status.connected ? (
            <button type="button" className="v2-act tap-target" onClick={() => { window.location.href = `/api/auth/stripe/connect?agentId=${encodeURIComponent(agentId)}` }}>Connect Stripe</button>
          ) : (
            <button type="button" onClick={disconnect} disabled={busy} className="v2-act tap-target" data-danger><Link2Off className="w-3.5 h-3.5" /> Disconnect</button>
          )}
        </div>
      )}
    </div>
  )
}
