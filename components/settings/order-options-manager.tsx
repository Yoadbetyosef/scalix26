'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { OrderOption, OrderOptionList } from '@/lib/orders/options'

// Self-service editor for the dropdowns on order line items. Tatiana adds, renames, reorders and retires
// options here without a developer. Nothing here can damage an existing order: line items store the label
// text they were saved with, so a retired or renamed option leaves history untouched.

export function OrderOptionsManager() {
  const [lists, setLists] = useState<OrderOptionList[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Bumped on every reload and folded into each card's key, so a card re-initialises from fresh props
  // instead of syncing them into local state.
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      // ?all=1 — the manager shows hidden options too, so they can be brought back.
      const r = await fetch('/api/orders/options?all=1')
      if (!r.ok) throw new Error('Could not load your dropdown lists.')
      setLists((await r.json()).lists ?? [])
      setVersion((v) => v + 1)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/orders/options?all=1')
        if (!alive) return
        if (!r.ok) throw new Error('Could not load your dropdown lists.')
        setLists((await r.json()).lists ?? [])
      } catch (e) { if (alive) setErr((e as Error).message) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  if (err) return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>

  // No lists at all — offer a starter set for the trade, or a blank list to build from scratch. This is
  // the only path that ever creates lists, so nothing is assumed about what business this is.
  if (!lists.length) return <EmptyState onChanged={load} />

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        These are the choices that appear in the dropdowns when you build an order. Change them whenever you like —
        past orders keep whatever was chosen at the time, so nothing you do here can alter an order already placed.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {lists.map((list) => <ListCard key={`${list.id}-${version}`} list={list} onChanged={load} />)}
      </div>
      <NewListButton onChanged={load} />
    </div>
  )
}

interface TemplateInfo { id: string; name: string; description: string; lists: Array<{ label: string; count: number }> }

function EmptyState({ onChanged }: { onChanged: () => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/orders/options/lists')
        if (!alive || !r.ok) return
        setTemplates((await r.json()).templates ?? [])
      } catch { /* the blank-list path below still works without templates */ }
    })()
    return () => { alive = false }
  }, [])

  const apply = async (id: string) => {
    setBusy(id); setErr(null)
    try {
      const r = await fetch('/api/orders/options/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: id }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not set that up.')
      onChanged()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6">
        <h3 className="text-sm font-semibold text-gray-900">No dropdowns yet</h3>
        <p className="mt-1 text-sm text-gray-600">
          Start from a set built for your trade, or make your own list from scratch. Either way everything stays
          yours to rename, reorder and delete afterwards.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-sm font-semibold text-gray-900">{t.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t.description}</p>
              <p className="mt-2 text-xs text-gray-400">{t.lists.map((l) => `${l.label} (${l.count})`).join(' · ')}</p>
              <button onClick={() => apply(t.id)} disabled={!!busy} className="mt-3 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
                {busy === t.id ? 'Setting up…' : `Use ${t.name}`}
              </button>
            </div>
          ))}
        </div>
        {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
      </div>
      <NewListButton onChanged={onChanged} />
    </div>
  )
}

// Create an empty list of the tenant's own — the path that makes this work for a trade with no template.
function NewListButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const create = async () => {
    if (!label.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/orders/options/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not create that list.')
      setLabel(''); setOpen(false); onChanged()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
        <Plus className="h-3.5 w-3.5" /> New dropdown list
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <label className="block text-xs text-gray-500">
        What is this list called?
        <input
          value={label} onChange={(e) => setLabel(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } if (e.key === 'Escape') setOpen(false) }}
          placeholder="e.g. Lock type, Wood species, Fabric grade"
          className="mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={create} disabled={busy || !label.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">{busy ? 'Creating…' : 'Create'}</button>
        <button onClick={() => { setOpen(false); setErr(null) }} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  )
}

function ListCard({ list, onChanged }: { list: OrderOptionList; onChanged: () => void }) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Optimistic local order so a move feels instant; the server call follows. Seeded once from props —
  // the parent remounts this card (keyed on its reload version) whenever fresh data arrives.
  const [options, setOptions] = useState<OrderOption[]>(list.options)
  const [renaming, setRenaming] = useState(false)
  const [listLabel, setListLabel] = useState(list.label)
  const [confirmDeleteList, setConfirmDeleteList] = useState(false)

  const call = async (fn: () => Promise<Response>, refresh = true) => {
    setBusy(true); setErr(null)
    try {
      const r = await fn()
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That didn’t save.')
      if (refresh) onChanged()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const add = async () => {
    const label = adding.trim()
    if (!label) return
    await call(() => fetch('/api/orders/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listId: list.id, label }) }))
    setAdding('')
  }

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= options.length) return
    const next = [...options]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOptions(next)                      // show the move immediately
    await call(() => fetch('/api/orders/options/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listId: list.id, ids: next.map((o) => o.id) }) }), false)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        {renaming ? (
          <input
            value={listLabel} onChange={(e) => setListLabel(e.target.value)} autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setRenaming(false); if (listLabel.trim() && listLabel !== list.label) call(() => fetch(`/api/orders/options/lists/${list.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: listLabel }) })) }
              if (e.key === 'Escape') { setListLabel(list.label); setRenaming(false) }
            }}
            onBlur={() => { setRenaming(false); setListLabel(list.label) }}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-semibold"
          />
        ) : (
          <h3 className="flex-1 text-sm font-semibold text-gray-900">{list.label}</h3>
        )}
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-400">{options.filter((o) => o.active).length} in use</span>
          <button onClick={() => setRenaming(true)} disabled={busy} className="text-gray-300 hover:text-gray-700" title="Rename this list"><Pencil className="h-3.5 w-3.5" /></button>
          {confirmDeleteList ? (
            <span className="flex items-center gap-1">
              <button onClick={() => call(() => fetch(`/api/orders/options/lists/${list.id}`, { method: 'DELETE' }))} className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Delete list</button>
              <button onClick={() => setConfirmDeleteList(false)} className="text-[10px] text-gray-500">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDeleteList(true)} disabled={busy} className="text-gray-300 hover:text-red-600" title="Delete this whole list"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </span>
      </div>

      <ul className="divide-y divide-gray-100">
        {options.map((o, i) => (
          <OptionRow
            key={o.id} option={o} busy={busy}
            canMoveUp={i > 0} canMoveDown={i < options.length - 1}
            onMove={(d) => move(i, d)}
            onRename={(label) => call(() => fetch(`/api/orders/options/${o.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) }))}
            onToggle={() => call(() => fetch(`/api/orders/options/${o.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !o.active }) }))}
            onDelete={() => call(() => fetch(`/api/orders/options/${o.id}`, { method: 'DELETE' }))}
          />
        ))}
        {!options.length && <li className="py-3 text-sm text-gray-400">Nothing here yet — add your first option below.</li>}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={adding} onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add an option…"
          className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
        />
        <button onClick={add} disabled={busy || !adding.trim()} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}

function OptionRow({ option, busy, canMoveUp, canMoveDown, onMove, onRename, onToggle, onDelete }: {
  option: OrderOption; busy: boolean
  canMoveUp: boolean; canMoveDown: boolean
  onMove: (d: -1 | 1) => void
  onRename: (label: string) => void
  onToggle: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(option.label)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const commit = () => {
    const v = draft.trim()
    setEditing(false)
    if (v && v !== option.label) onRename(v)
    else setDraft(option.label)
  }

  return (
    <li className="flex items-center gap-1.5 py-1.5">
      <div className="flex flex-col">
        <button onClick={() => onMove(-1)} disabled={!canMoveUp || busy} className="text-gray-300 hover:text-gray-700 disabled:opacity-30" title="Move up"><ArrowUp className="h-3 w-3" /></button>
        <button onClick={() => onMove(1)} disabled={!canMoveDown || busy} className="text-gray-300 hover:text-gray-700 disabled:opacity-30" title="Move down"><ArrowDown className="h-3 w-3" /></button>
      </div>

      {editing ? (
        <>
          <input
            value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(option.label); setEditing(false) } }}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button onClick={commit} className="text-emerald-600 hover:text-emerald-800" title="Save"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={() => { setDraft(option.label); setEditing(false) }} className="text-gray-400 hover:text-gray-700" title="Cancel"><X className="h-3.5 w-3.5" /></button>
        </>
      ) : (
        <>
          <span className={`flex-1 text-sm ${option.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{option.label}</span>
          <button onClick={() => setEditing(true)} disabled={busy} className="text-gray-300 hover:text-gray-700" title="Rename"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onToggle} disabled={busy} className="text-gray-300 hover:text-gray-700" title={option.active ? 'Hide from new orders' : 'Show again'}>
            {option.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <button onClick={onDelete} className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-gray-500">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} disabled={busy} className="text-gray-300 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </>
      )}
    </li>
  )
}
