'use client'

import { useCallback, useEffect, useState } from 'react'

interface Att { id: string; fileName: string; mimeType: string; fileSize: number; visibility: 'internal' | 'public'; url: string | null }
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

export function AttachmentsPanel({ orderId }: { orderId: string }) {
  const [items, setItems] = useState<Att[]>([])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const base = `/api/orders/${orderId}/attachments`

  const load = useCallback(async () => {
    const r = await fetch(base); if (r.ok) setItems((await r.json()).attachments)
  }, [base])
  useEffect(() => { let active = true; (async () => { const r = await fetch(base); if (active && r.ok) setItems((await r.json()).attachments) })(); return () => { active = false } }, [base])

  const upload = async (file: File) => {
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(base, { method: 'POST', body: fd })
      if (!r.ok) throw new Error((await r.json()).error || 'Upload failed')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const setVisibility = async (id: string, visibility: 'internal' | 'public') => {
    setBusy(true); try { await fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }) }); await load() } finally { setBusy(false) }
  }
  const remove = async (id: string) => { if (!confirm('Delete this attachment?')) return; setBusy(true); try { await fetch(`${base}/${id}`, { method: 'DELETE' }); await load() } finally { setBusy(false) } }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <label className="mb-3 inline-block cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
        {busy ? 'Working…' : '+ Upload file'}
        <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
      </label>
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 text-sm">
            {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{x.fileName}</a> : <span className="text-gray-700">{x.fileName}</span>}
            <span className="text-xs text-gray-400">{kb(x.fileSize)}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${x.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{x.visibility === 'public' ? 'Shared on approval' : 'Internal only'}</span>
            <span className="ml-auto flex gap-2">
              <button onClick={() => setVisibility(x.id, x.visibility === 'public' ? 'internal' : 'public')} disabled={busy} className="text-xs text-gray-600 underline">{x.visibility === 'public' ? 'Make internal' : 'Share on approval'}</button>
              <button onClick={() => remove(x.id)} disabled={busy} className="text-xs text-red-600 underline">Delete</button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-gray-400">No attachments.</li>}
      </ul>
      <p className="mt-2 text-[11px] text-gray-400">Only files marked “Shared on approval” appear on the external approval page. The bucket is private; links are short-lived.</p>
    </div>
  )
}
