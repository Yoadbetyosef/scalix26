'use client'

import { useState } from 'react'

const btn = (bg: string): React.CSSProperties => ({ padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#fff', background: bg, border: 'none', cursor: 'pointer' })

// PUBLIC factory hand-off (no account). Once the order is in production, the factory uploads an invoice and
// marks the item ready. Posts multipart to /api/approval/[token]/delivery, which moves the order to Ready.
export function FactoryDelivery({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false)

  const submit = async () => {
    if (!file) { setErr('Please attach the invoice first.'); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/approval/${token}/delivery`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error((await r.json()).error || 'Could not submit. Please try again.')
      setDone(true)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (done) return <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 14, color: '#166534' }}>Thank you — the item is marked <strong>ready</strong> and your invoice has been sent to the team. You can close this page.</div>

  return (
    <div>
      {err && <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>{err}</div>}
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 10px' }}>When the order is finished, upload your invoice and mark it ready. The team will be notified.</p>
      <label style={{ display: 'inline-block', cursor: 'pointer', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151' }}>
        {file ? file.name : 'Choose invoice (PDF or image)'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" style={{ display: 'none' }} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null) }} />
      </label>
      <div style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy || !file} style={{ ...btn('#059669'), opacity: busy || !file ? 0.5 : 1 }}>{busy ? 'Submitting…' : 'Upload invoice & mark ready'}</button>
      </div>
    </div>
  )
}
