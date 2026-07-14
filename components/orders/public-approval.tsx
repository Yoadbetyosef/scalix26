'use client'

import { useState } from 'react'

type Decision = 'approved' | 'changes_requested' | 'rejected'
const btn = (bg: string): React.CSSProperties => ({ padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#fff', background: bg, border: 'none', cursor: 'pointer' })
const input: React.CSSProperties = { width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }

export function PublicApprovalForm({ token, approvalType }: { token: string; approvalType: 'factory' | 'customer' }) {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [comment, setComment] = useState('')
  const [estDate, setEstDate] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false)

  const submit = async () => {
    if (!decision) return
    if ((decision === 'changes_requested' || decision === 'rejected') && !comment.trim()) { setErr('Please add a comment explaining what you need.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/approval/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comment: comment.trim() || null, estimatedCompletionDate: estDate || null }) })
      if (!r.ok) throw new Error((await r.json()).error || 'Could not submit your response.')
      setDone(true)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (done) return <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 14, color: '#166534' }}>Thank you — your response has been sent to {approvalType === 'factory' ? 'the team' : 'the seller'}. You can close this page.</div>

  return (
    <div>
      {err && <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => setDecision('approved')} style={{ ...btn(decision === 'approved' ? '#059669' : '#d1fae5'), color: decision === 'approved' ? '#fff' : '#065f46' }}>Approve</button>
        <button onClick={() => setDecision('changes_requested')} style={{ ...btn(decision === 'changes_requested' ? '#d97706' : '#fef3c7'), color: decision === 'changes_requested' ? '#fff' : '#92400e' }}>Request Changes</button>
        <button onClick={() => setDecision('rejected')} style={{ ...btn(decision === 'rejected' ? '#dc2626' : '#fee2e2'), color: decision === 'rejected' ? '#fff' : '#991b1b' }}>Reject</button>
      </div>
      {decision && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>{decision === 'approved' ? 'Comment (optional)' : 'Comment (required)'}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} style={input} /></label>
          {decision === 'approved' && <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginTop: 8 }}>Estimated completion date (optional)<input type="date" value={estDate} onChange={(e) => setEstDate(e.target.value)} style={input} /></label>}
          <button onClick={submit} disabled={busy} style={{ ...btn('#111827'), marginTop: 12, opacity: busy ? 0.5 : 1 }}>{busy ? 'Submitting…' : 'Submit response'}</button>
        </div>
      )}
    </div>
  )
}
