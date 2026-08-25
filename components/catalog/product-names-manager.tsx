'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardPaste, Eye, EyeOff, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { ProductNameRow } from '@/lib/catalog/product-names'

// The business's own product list, editable by the business. Add one, paste a whole column out of a
// spreadsheet, rename, re-categorise, hide or delete — no developer, no import file, no migration.
//
// Deleting only removes a name from the suggestions. Products already in the catalog keep their own
// name, so nothing here can damage what's already been created — which is what makes it safe to hand over.


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

  if (loading) return <p className="v2-kick"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
  if (err) return (
    <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
      <span className="v2-chip-sq"><X /></span>
      <p>{err}</p>
    </div>
  )

  return (
    <div>
      <p className="v2-hint" style={{ maxWidth: '62ch', marginBottom: 22 }}>
        These names appear as suggestions when you add a product, so nobody has to type them — or mistype them.
        Deleting one here only removes the suggestion; products already in your catalog are never touched.
      </p>

      <AddRow categories={categories} onChanged={load} />

      <div className="v2-fld" style={{ position: 'relative', maxWidth: 320, margin: '26px 0 18px' }}>
        <label htmlFor="names-q">Search your list</label>
        <input id="names-q" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or category…" style={{ paddingRight: 24 }} />
        <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />
      </div>

      {groups.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>{items.length === 0 ? 'Nothing on the list yet' : `Nothing matches “${filter}”`}</b>
          <span>{items.length === 0 ? 'Add your first product name above, or paste a whole column out of a spreadsheet.' : 'Clear the search to see all ' + items.length + ' names.'}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 26 }}>
          {/* A CATEGORY IS A SECTION, not a boxed card with a grey title bar. Same micro-label and
              rule as every other group on this screen, with the count on the end where the header
              already carries counts. */}
          {groups.map(([cat, rows]) => (
            <div key={cat}>
              <div className="v2-head">
                <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />{cat}</p>
                <s />
                <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>{rows.length}</span>
              </div>
              <ul className="v2-list">
                {rows.map((it) => <Row key={it.id} item={it} onChanged={load} />)}
              </ul>
            </div>
          ))}
          <p className="v2-kick">{shown.length === items.length ? `${items.length} names` : `${shown.length} of ${items.length}`}</p>
        </div>
      )}
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
    <div className="v2-fld" style={{ width: 190 }}>
      <label htmlFor="pn-cat">Category</label>
      <input id="pn-cat" list="product-name-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" />
    </div>
  )

  return (
    <div>
      <datalist id="product-name-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      {!pasting ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 18 }}>
            <div className="v2-fld" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="pn-name">Product name</label>
              <input
                id="pn-name" value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOne() } }}
                placeholder="e.g. Neomi Sofa"
              />
            </div>
            {categoryInput}
            <button onClick={addOne} disabled={busy || !name.trim()} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)', marginBottom: 4 }}>
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          {/* A real control, so it looks like one. As a micro-label it read as a caption on the row
              above it and nobody would have tried clicking it. */}
          <button onClick={() => { setPasting(true); setErr(null); setMsg(null) }} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t3)', marginTop: 16 }}>
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste a list from a spreadsheet
          </button>
        </>
      ) : (
        <>
          <div className="v2-head">
            <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Paste a list</p>
            <s />
            <button onClick={() => { setPasting(false); setBulk(''); setErr(null) }} aria-label="Close" className="v2-ico"><X /></button>
          </div>
          <div className="v2-fld">
            <label htmlFor="pn-bulk">One name per line</label>
            <textarea
              id="pn-bulk" value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6}
              placeholder={'Copy a column out of Excel and paste it here.\nOne product name per line.'}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 18, marginTop: 18 }}>
            {categoryInput}
            <button onClick={addMany} disabled={busy || !bulk.trim()} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)', marginBottom: 4 }}>
              {busy ? 'Adding…' : 'Add all'}
            </button>
            <p className="v2-hint" style={{ flex: 1, minWidth: 200, marginBottom: 4 }}>They all go into this one category. Names already on the list are skipped.</p>
          </div>
        </>
      )}

      {msg && <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)', marginTop: 12 }}>{msg}</p>}
      {err && <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-red)', marginTop: 12, color: 'var(--v2-red-ink)' }}>{err}</p>}
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
    <li className="v2-row" style={{ ['--chan' as string]: item.active ? 'var(--v2-t3)' : 'var(--v2-mute)' }}>
      {editing ? (
        <>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={`pn-e-${item.id}`}>Name</label>
            <input id={`pn-e-${item.id}`} value={name} onChange={(e) => setName(e.target.value)} autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(item.name); setCategory(item.category ?? ''); setEditing(false) } }} />
          </div>
          <div className="v2-fld" style={{ width: 160 }}>
            <label htmlFor={`pn-c-${item.id}`}>Category</label>
            <input id={`pn-c-${item.id}`} list="product-name-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <button onClick={save} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-t3)' }} title="Save" aria-label="Save"><Check /></button>
          <button onClick={() => { setName(item.name); setCategory(item.category ?? ''); setEditing(false) }} className="v2-ico" title="Cancel" aria-label="Cancel"><X /></button>
        </>
      ) : (
        <>
          <div className="v2-m">
            <p><span className="truncate" style={item.active ? undefined : { textDecoration: 'line-through', color: 'var(--v2-mute)' }}>{item.name}</span></p>
          </div>
          <button onClick={() => setEditing(true)} disabled={busy} className="v2-ico" title="Rename or change category" aria-label="Rename or change category"><Pencil /></button>
          <button
            onClick={() => call({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }) })}
            disabled={busy} className="v2-ico"
            title={item.active ? 'Hide from suggestions' : 'Show again'}
            aria-label={item.active ? 'Hide from suggestions' : 'Show again'}
          >{item.active ? <Eye /> : <EyeOff />}</button>
          {/* The inline two-step stays: this deletes one suggestion and touches no product, so it does
              not warrant the modal the catalogue's own delete gets. The distinction is the point —
              a dialog for every destructive act teaches people to dismiss dialogs. */}
          {confirm ? (
            <span className="flex items-center gap-1.5 flex-none">
              <button onClick={() => call({ method: 'DELETE' })} className="v2-act" data-solid data-danger>Delete</button>
              <button onClick={() => setConfirm(false)} className="v2-act">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirm(true)} disabled={busy} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} title="Delete" aria-label={`Delete ${item.name}`}><Trash2 /></button>
          )}
        </>
      )}
      {err && <span className="v2-kick" style={{ width: '100%', color: 'var(--v2-red-ink)' }}>{err}</span>}
    </li>
  )
}
