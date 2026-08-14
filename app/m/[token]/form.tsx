'use client'

import { useState } from 'react'

// THE THREE ACTIONS, on a page the owner reached from a text message.
//
// Self-contained styling rather than the /v2 stylesheet: this page is opened on a phone, by someone
// who is not logged in, from a link — it has no navigation, no session, and nothing else on it. The
// values are the mockup's own draft box and buttons.

export interface DraftView {
  who: string
  channel: string | null
  question: string | null
  body: string
  trigger: string
  heldFor: string
  agentName: string
}

const ACID = '#d9f224'
const HOLD = '#f5a524'

export function DecideForm({ token, draft }: { token: string; draft: DraftView }) {
  const [text, setText] = useState(draft.body)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'send' | 'handle' | null>(null)
  const [done, setDone] = useState<'sent' | 'handled' | null>(null)
  const [error, setError] = useState('')

  async function decide(action: 'send' | 'handle') {
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/m/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, body: action === 'send' && editing ? text : undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'That did not work.'); return }
      setDone(action === 'send' ? 'sent' : 'handled')
    } catch {
      setError('That did not send — check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  // The decided state says what happened AND what was sent. A confirmation that hides the words is
  // the same failure as a row that says "handled" without them.
  if (done) {
    return (
      <div style={{ padding: '18px 16px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,.07)' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
          {done === 'sent' ? `Sent to ${draft.who}.` : `${draft.agentName} will leave this thread to you.`}
        </p>
        {done === 'sent' && (
          <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.45, color: '#3d3d45' }}>“{text}”</p>
        )}
        {done === 'handled' && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b6b73' }}>
            Nothing was sent. {draft.agentName} will not reply on this conversation again.
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Edit the reply"
          style={{
            width: '100%', minHeight: 132, padding: '11px 12px', fontSize: 15, lineHeight: 1.45,
            fontFamily: 'inherit', color: '#0e0e11', background: '#f7f7f8', borderRadius: 10,
            border: 'none', borderLeft: `2px solid ${HOLD}`, resize: 'vertical',
          }}
        />
      ) : (
        <div style={{
          background: '#f7f7f8', borderLeft: `2px solid ${HOLD}`, borderRadius: 10, padding: '11px 12px',
          fontSize: 15, lineHeight: 1.45, color: '#0e0e11', whiteSpace: 'pre-wrap',
        }}>{draft.body}</div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => decide('send')}
          disabled={!!busy}
          style={{ flex: 1, minHeight: 44, borderRadius: 10, border: 'none', background: ACID, color: '#20260a', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}
        >
          {busy === 'send' ? 'Sending…' : editing ? 'Send edit' : 'Send'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          disabled={!!busy}
          style={{ flex: 1, minHeight: 44, borderRadius: 10, background: '#fff', color: '#0e0e11', border: '1px solid rgba(0,0,0,.1)', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
        <button
          type="button"
          onClick={() => decide('handle')}
          disabled={!!busy}
          style={{ flex: 1, minHeight: 44, borderRadius: 10, background: '#fff', color: '#0e0e11', border: '1px solid rgba(0,0,0,.1)', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}
        >
          {busy === 'handle' ? 'Handing over…' : "I'll handle it"}
        </button>
      </div>

      <p style={{
        margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.4, padding: '8px 10px', borderRadius: 8,
        background: error ? 'rgba(255,92,108,.12)' : '#fef3dc', color: error ? '#7a1020' : '#6b4708',
      }}>
        {error
          ? `${error} It is still waiting for you.`
          : `Held ${draft.heldFor}. Nothing goes out until you decide.`}
      </p>
    </>
  )
}
