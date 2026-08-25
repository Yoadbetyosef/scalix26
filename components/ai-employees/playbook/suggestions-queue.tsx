'use client'

import { useState } from 'react'
import { channelHue } from '@/app/(v2)/v2/channels'
import { PLAYBOOK_SECTIONS } from '@/lib/playbook/types'

export interface Suggestion {
  id: string
  section: string
  observation: string
  proposed: { text?: string; customer?: string; reply?: string }
  channels: string[]
  confidence: number
  created_at: string
}

const labelOf = (key: string) => PLAYBOOK_SECTIONS.find((s) => s.key === key)?.label || key

export function SuggestionsQueue({
  agentId,
  initial,
  onApplied,
}: {
  agentId: string
  initial: Suggestion[]
  onApplied: () => void
}) {
  const [items, setItems] = useState<Suggestion[]>(initial)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function scan() {
    setScanning(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/playbook/${agentId}/suggestions`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Scan failed')
      const list = await (await fetch(`/api/playbook/${agentId}/suggestions`)).json()
      setItems(list.suggestions || [])
      setMsg(d.added ? `Found ${d.added} new suggestion${d.added > 1 ? 's' : ''}.` : 'No new suggestions from recent conversations.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id)
    try {
      const r = await fetch(`/api/playbook/${agentId}/suggestions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Failed') }
      setItems((xs) => xs.filter((x) => x.id !== id))
      if (action === 'approve') onApplied()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Suggested improvements</p>
        <s />
        <button disabled={scanning} onClick={scan} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
          {scanning ? 'Scanning…' : 'Scan conversations'}
        </button>
      </div>
      <p className="v2-hint" style={{ maxWidth: '60ch', marginBottom: 18 }}>
        Learned from your real conversations. Nothing changes until you approve it.
      </p>

      {msg && <p className="v2-kick" style={{ marginBottom: 14 }}>{msg}</p>}

      {items.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>No pending suggestions</b>
          <span>Run a scan once your AI has handled some conversations — it proposes changes from what actually happened, never from guesses.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 22 }}>
          {items.map((s) => (
            <section key={s.id}>
              <div className="v2-head">
                <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />{labelOf(s.section)}</p>
                <s />
                {s.channels.slice(0, 4).map((c) => (
                  <span key={c} className="v2-stat" style={{ ['--chan' as string]: channelHue(c) }}>{c}</span>
                ))}
                <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>{Math.round(s.confidence * 100)}% sure</span>
              </div>
              <p style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--v2-ink)' }}>{s.observation}</p>
              {/* What it would add, set as the quotation it is. */}
              <p className="v2-quote" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>
                {s.proposed.text || (s.proposed.customer ? `“${s.proposed.customer}” → “${s.proposed.reply}”` : '')}
              </p>
              <div className="v2-bar" style={{ marginTop: 14 }}>
                <button disabled={busy === s.id} onClick={() => act(s.id, 'approve')} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
                  {busy === s.id ? 'Adding…' : 'Add to playbook'}
                </button>
                <button disabled={busy === s.id} onClick={() => act(s.id, 'reject')} className="v2-act tap-target">Dismiss</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
