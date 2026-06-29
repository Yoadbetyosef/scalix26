'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink">Suggested improvements</h3>
          <p className="text-xs text-muted">Learned from your real conversations. Nothing changes until you approve it.</p>
        </div>
        <Button variant="outline" size="sm" loading={scanning} onClick={scan}>
          Scan conversations
        </Button>
      </div>

      {msg && <p className="mb-3 text-xs text-subtle">{msg}</p>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline-strong p-8 text-center">
          <p className="text-sm text-muted">No pending suggestions. Run a scan after your AI has handled some conversations.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.id} className="rounded-2xl bg-white p-4 shadow-e1 ring-1 ring-hairline">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-subtle">{labelOf(s.section)}</span>
                {s.channels.slice(0, 4).map((c) => (
                  <span key={c} className="text-[11px] text-muted">{c}</span>
                ))}
                <span className="ml-auto text-[11px] text-muted">{Math.round(s.confidence * 100)}% sure</span>
              </div>
              <p className="mt-2 text-sm text-ink">{s.observation}</p>
              <p className="mt-1 rounded-lg bg-sunken px-3 py-2 text-[13px] text-subtle">
                {s.proposed.text || (s.proposed.customer ? `“${s.proposed.customer}” → “${s.proposed.reply}”` : '')}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" loading={busy === s.id} onClick={() => act(s.id, 'approve')}>Add to playbook</Button>
                <Button variant="ghost" size="sm" disabled={busy === s.id} onClick={() => act(s.id, 'reject')}>Dismiss</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
