'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export function SupplierForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ companyName: '', factoryName: '', email: '', phone: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const submit = async () => {
    if (!f.companyName.trim()) { setErr('Company name required'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/commerce/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: f.companyName.trim(), factoryName: f.factoryName || null, email: f.email || null, phone: f.phone || null }) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      setOpen(false); setF({ companyName: '', factoryName: '', email: '', phone: '' }); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <button onClick={() => { setErr(null); setOpen(true) }} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New supplier</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="my-16 w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">New supplier</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-gray-500">Company name<input value={f.companyName} onChange={set('companyName')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Factory name<input value={f.factoryName} onChange={set('factoryName')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Email (for factory PO emails)<input value={f.email} onChange={set('email')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Phone<input value={f.phone} onChange={set('phone')} className={inp} /></label>
            </div>
            {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
            <div className="mt-4 flex gap-2"><button onClick={submit} disabled={busy || !f.companyName.trim()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : 'Create'}</button><button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button></div>
          </div>
        </div>
      )}
    </>
  )
}
