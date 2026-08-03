'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { ProductNameRow } from '@/lib/catalog/product-names'

// The business's own product list, editable by the business. Add one, paste a whole column out of a
// spreadsheet, rename, re-categorise, hide or delete — no developer, no import file, no migration.
//
// Deleting only removes a name from the suggestions. Products already in the catalog keep their own
// name, so nothing here can damage what's already been created — which is what makes it safe to hand over.

const inp = 'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export function ProductNamesManager() {
  const [items, setItems] = useState<ProductNameRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = async () => {
    try {
      const r = await fetch('/api/catalog/product-names/manage')
      if (!r.ok) throw new Error('Could not load your product list.')
      setItems((await r.json()).names ?? [])
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/catalog/product-names/manage')
        if (!alive) return
        if (!r.ok) throw new Error('Could not load your product list.')
        setItems((await r.json()).names ?? [])
      } catch (e) { if (alive) setErr((e as Error).message) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
    [items],
  )
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
  }, [items, filter])

  // Group for display; the API already returns them ordered by category then name.
  const groups = useMemo(() => {
    const m = new Map<string, ProductNameRow[]>()
    for (const i of shown) {
      const k = i.category ?? 'Uncategorised'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(i)
    }
    return [...m.entries()]
  }, [shown])

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  if (err) return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        These names appear as suggestions when you add a product, so nobody has to type them — or mistype them.
        Deleting one here only removes the suggestion; products already in your catalog are never touched.
      </p>

      <AddRow categories={categories} onChanged={load} />

      <div className="flex items-center justify-between gap-3">
        <label className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your list…" className={`${inp} w-full pl-8`} />
        </label>
        <span className="text-xs text-gray-500">
          {shown.length === items.length ? `${items.length} names` : `${shown.length} of ${items.length}`}
        </span>
      </div>

      {groups.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">Nothing here yet — add your first product name above.</p>}

      <div className="space-y-4">
        {groups.map(([cat, rows]) => (
          <div key={cat} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-baseline justify-between bg-gray-50 px-4 py-2">
              <h3 className="text-sm font-semibold text-gray-900">{cat}</h3>
              <span className="text-xs text-gray-400">{rows.length}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {rows.map((it) => <Row key={it.id} item={it} onChanged={load} />)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// Add one name, or paste a whole column out of a spreadsheet — which is how a list this size actually
// arrives. Both go into the category chosen alongside.
function AddRow({ categories, onChanged }: { categories: string[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [bulk, setBulk] = useState('')
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/catalog/product-names/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'That didn’t save.')
      return j
    } catch (e) { setErr((e as Error).message); return null } finally { setBusy(false) }
  }

  const addOne = async () => {
    if (!name.trim()) return
    if (await post({ name, category: category || null })) { setName(''); onChanged() }
  }
  const addMany = async () => {
    const j = await post({ bulk, category: category || null })
    if (j) {
      setMsg(`Added ${j.added}${j.skipped ? `, skipped ${j.skipped} already on the list` : ''}.`)
      setBulk(''); onChanged()
    }
  }

  const categoryInput = (
    <input
      list="product-name-categories" value={category} onChange={(e) => setCategory(e.target.value)}
      placeholder="Category (optional)" className={`${inp} w-48`}
    />
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <datalist id="product-name-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      {!pasting ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOne() } }}
              placeholder="Product name" className={`${inp} min-w-[14rem] flex-1`}
            />
            {categoryInput}
            <button onClick={addOne} disabled={busy || !name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <button onClick={() => { setPasting(true); setErr(null); setMsg(null) }} className="mt-2 text-xs text-blue-600 hover:underline">
            Or paste a list from a spreadsheet
          </button>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Paste a list</span>
            <button onClick={() => { setPasting(false); setBulk(''); setErr(null) }} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
          </div>
          <textarea
            value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6}
            placeholder={'Copy a column out of Excel and paste it here.\nOne product name per line.'}
            className={`${inp} w-full`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {categoryInput}
            <button onClick={addMany} disabled={busy || !bulk.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
              {busy ? 'Adding…' : 'Add all'}
            </button>
            <span className="text-xs text-gray-500">They all go into this one category. Names already on the list are skipped.</span>
          </div>
        </>
      )}

      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}

// Categories come from the shared <datalist> the AddRow renders, so this row needs no list of its own.
function Row({ item, onChanged }: { item: ProductNameRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category ?? '')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const call = async (init: RequestInit) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/catalog/product-names/manage/${item.id}`, init)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That didn’t save.')
      onChanged()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const save = () => {
    setEditing(false)
    if (name.trim() === item.name && (category.trim() || null) === item.category) return
    call({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category: category || null }) })
  }

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2">
      {editing ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(item.name); setCategory(item.category ?? ''); setEditing(false) } }} className={`${inp} flex-1`} />
          <input list="product-name-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className={`${inp} w-44`} />
          <button onClick={save} className="text-emerald-600 hover:text-emerald-800" title="Save"><Check className="h-4 w-4" /></button>
          <button onClick={() => { setName(item.name); setCategory(item.category ?? ''); setEditing(false) }} className="text-gray-400 hover:text-gray-700" title="Cancel"><X className="h-4 w-4" /></button>
        </>
      ) : (
        <>
          <span className={`flex-1 text-sm ${item.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{item.name}</span>
          <button onClick={() => setEditing(true)} disabled={busy} className="text-gray-300 hover:text-gray-700" title="Rename or change category"><Pencil className="h-3.5 w-3.5" /></button>
          <button
            onClick={() => call({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }) })}
            disabled={busy} className="text-gray-300 hover:text-gray-700"
            title={item.active ? 'Hide from suggestions' : 'Show again'}
          >{item.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
          {confirm ? (
            <span className="flex items-center gap-1">
              <button onClick={() => call({ method: 'DELETE' })} className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Delete</button>
              <button onClick={() => setConfirm(false)} className="text-[10px] text-gray-500">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirm(true)} disabled={busy} className="text-gray-300 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </>
      )}
      {err && <span className="w-full text-xs text-red-600">{err}</span>}
    </li>
  )
}
