'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatusPill } from '@/app/(v2)/v2/controls'
import { useConfirm } from '@/components/v2/confirm'
import { BookText, Link2Off, AlertTriangle } from 'lucide-react'

type Status = { connected: boolean; companyName?: string | null; environment?: string; status?: string }

export function QuickbooksConnect({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useConfirm()

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const qb = p.get('qb')
    if (qb === 'connected') toast.success('QuickBooks connected!')
    else if (qb === 'denied') toast.error('QuickBooks connection was cancelled.')
    else if (qb === 'not_configured') toast.error('QuickBooks isn’t enabled on this account yet. Please contact support.')
    else if (qb === 'error') toast.error('Could not connect QuickBooks. Please try again.')
    let on = true
    fetch('/api/quickbooks/status')
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d) => { if (on) setStatus(d) })
      .catch(() => { if (on) setStatus({ connected: false }) })
    return () => { on = false }
  }, [])

  async function disconnect() {
    if (!(await ask({
      title: 'Disconnect QuickBooks',
      body: <>The link to your QuickBooks Online company is removed. Nothing already in QuickBooks changes, and you can connect it again at any time.</>,
      confirmLabel: 'Disconnect QuickBooks',
      danger: true,
    }))) return
    setBusy(true)
    try {
      const res = await fetch('/api/quickbooks/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error()
      setStatus({ connected: false })
      toast.success('QuickBooks disconnected')
    } catch {
      toast.error('Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  // The server reports its configured environment even before anything is connected, so this is the
  // live answer to "are we pointing at real books or a test company?".
  const isSandbox = status?.environment === 'sandbox'

  return (
    <div style={{ marginTop: 18 }}>
      {dialog}
      <div className="v2-grow" data-static>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><BookText /></span>
        <span className="v2-glab">
          <b style={{ fontWeight: 550 }}>Accounting (QuickBooks)</b>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>
            {status === null
              ? 'Checking…'
              : !status.connected
                ? 'Connect your QuickBooks Online account to link your accounting. Optional.'
                : <>QuickBooks Online is connected{status.companyName ? ` · ${status.companyName}` : ''}{status.environment ? ` · ${status.environment}` : ''}.</>}
          </span>
          {/* Which company you are about to link to, BEFORE you link it. A sandbox connection
              succeeds, reports "Connected", and syncs happily into a test company that no accountant
              will ever see — stated up front it is obvious, stated afterwards in small grey text it
              is missed. */}
          {isSandbox && <SandboxWarning connected={status?.connected} />}
        </span>
        <span className="v2-gtrail">
          {isSandbox && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-amber)' }}><AlertTriangle className="w-3 h-3" /> Sandbox</span>}
          {status === null ? null : <StatusPill state={status.connected ? 'live' : 'off'}>{status.connected ? 'Connected' : 'Not connected'}</StatusPill>}
        </span>
      </div>

      {status !== null && (
        <div className="v2-bar" style={{ marginTop: 12 }}>
          {!status.connected ? (
            <button type="button" className="v2-act tap-target" onClick={() => { window.location.href = `/api/quickbooks/connect?agentId=${encodeURIComponent(agentId)}` }}>Connect QuickBooks</button>
          ) : (
            <button type="button" onClick={disconnect} disabled={busy} className="v2-act tap-target" data-danger><Link2Off className="w-3.5 h-3.5" /> Disconnect</button>
          )}
        </div>
      )}
    </div>
  )
}

// Shown wherever the server is pointing at a QuickBooks sandbox. Sandbox is a real, working connection
// to a fake Intuit company — everything reports success and nothing reaches the business's accountant,
// which is precisely why it needs saying loudly rather than as a grey suffix.
function SandboxWarning({ connected }: { connected?: boolean }) {
  return (
    <span style={{ display: 'block', marginTop: 6, fontSize: 12.5, lineHeight: 1.45, color: 'var(--v2-hold-ink)' }}>
      <b style={{ fontWeight: 600 }}>Test mode.</b>{' '}
      {connected
        ? 'This is linked to an Intuit sandbox company, not your real books — nothing here reaches your accountant.'
        : 'This will link to an Intuit sandbox company, not your real books. Use it to try the sync; switch the server to production before relying on it.'}
    </span>
  )
}
