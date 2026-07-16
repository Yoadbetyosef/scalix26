'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
const TYPES: { v: string; label: string }[] = [
  { v: 'simple_product', label: 'Product' },
  { v: 'configurable_product', label: 'Collection (configurable)' },
  { v: 'component', label: 'Component' },
  { v: 'bundle', label: 'Bundle' },
  { v: 'service', label: 'Service' },
  { v: 'custom_item', label: 'Custom item' },
]

export function ProductForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ name: '', productType: 'simple_product', category: '', sku: '', defaultPrice: '', cost: '', status: 'draft' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    if (!f.name.trim()) { setErr('Name is required'); return }
    setBusy(true); setErr(null)
    try {
      const body = {
        name: f.name.trim(), productType: f.productType, category: f.category || null, sku: f.sku || null,
        status: f.status, defaultPrice: f.defaultPrice ? Number(f.defaultPrice) : null, cost: f.cost ? Number(f.cost) : null,
      }
      const r = await fetch('/api/commerce/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to create')
      setOpen(false); setF({ name: '', productType: 'simple_product', category: '', sku: '', defaultPrice: '', cost: '', status: 'draft' }); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => { setErr(null); setOpen(true) }} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New product</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">New catalog product</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-gray-500 sm:col-span-2">Name<input value={f.name} onChange={set('name')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Type<select value={f.productType} onChange={set('productType')} className={inp}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></label>
              <label className="block text-xs text-gray-500">Category<input value={f.category} onChange={set('category')} className={inp} placeholder="Sofas, Tables…" /></label>
              <label className="block text-xs text-gray-500">SKU<input value={f.sku} onChange={set('sku')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Status<select value={f.status} onChange={set('status')} className={inp}><option value="draft">Draft</option><option value="active">Active</option><option value="discontinued">Discontinued</option></select></label>
              <label className="block text-xs text-gray-500">Sale price ($)<input value={f.defaultPrice} onChange={set('defaultPrice')} className={inp} /></label>
              <label className="block text-xs text-gray-500">Cost ($)<input value={f.cost} onChange={set('cost')} className={inp} /></label>
            </div>
            {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={submit} disabled={busy || !f.name.trim()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : 'Create product'}</button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
