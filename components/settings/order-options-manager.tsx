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

  if (loading) return <p className="v2-kick"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
  if (err) return (
    <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
      <span className="v2-chip-sq"><X /></span><p>{err}</p>
    </div>
  )

  // No lists at all — offer a starter set for the trade, or a blank list to build from scratch. This is
  // the only path that ever creates lists, so nothing is assumed about what business this is.
  if (!lists.length) return <EmptyState onChanged={load} />

  return (
    <div>
      <p className="v2-hint" style={{ maxWidth: '64ch', marginBottom: 26 }}>
        These are the choices that appear in the dropdowns when you build an order. Change them whenever you like —
        past orders keep whatever was chosen at the time, so nothing you do here can alter an order already placed.
      </p>
      <div style={{ display: 'grid', gap: 30, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {lists.map((list) => <ListCard key={`${list.id}-${version}`} list={list} onChanged={load} />)}
      </div>
      <div style={{ marginTop: 26 }}><NewListButton onChanged={load} /></div>
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
    <div>
      <div className="v2-card" data-empty style={{ marginBottom: 26 }}>
        <b>No dropdowns yet</b>
        <span>
          Start from a set built for your trade, or make your own list from scratch. Either way everything stays
          yours to rename, reorder and delete afterwards.
        </span>
      </div>

      {templates.length > 0 && (
        <div className="v2-list" style={{ marginBottom: 20 }}>
          {templates.map((t) => (
            <div key={t.id} className="v2-row" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>
              <div className="v2-m">
                <p><span className="truncate">{t.name}</span></p>
                <span>{t.description} · {t.lists.map((l) => `${l.label} (${l.count})`).join(' · ')}</span>
              </div>
              <button onClick={() => apply(t.id)} disabled={!!busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
                {busy === t.id ? 'Setting up…' : `Use ${t.name}`}
              </button>
            </div>
          ))}
        </div>
      )}
      {err && <p className="v2-kick" style={{ color: 'var(--v2-red-ink)', marginBottom: 14 }}>{err}</p>}
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
      <button onClick={() => setOpen(true)} className="v2-act tap-target">
        <Plus className="w-3.5 h-3.5" /> New dropdown list
      </button>
    )
  }
  return (
    <div style={{ maxWidth: 420 }}>
      <div className="v2-fld">
        <label htmlFor="ool-new">What is this list called?</label>
        <input
          id="ool-new" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } if (e.key === 'Escape') setOpen(false) }}
          placeholder="e.g. Lock type, Wood species, Fabric grade"
        />
      </div>
      {err && <p className="v2-kick" style={{ color: 'var(--v2-red-ink)', marginTop: 10 }}>{err}</p>}
      <div className="v2-bar" style={{ marginTop: 16 }}>
        <button onClick={create} disabled={busy || !label.trim()} className="v2-act tap-target" data-solid>{busy ? 'Creating…' : 'Create'}</button>
        <button onClick={() => { setOpen(false); setErr(null) }} disabled={busy} className="v2-act tap-target">Cancel</button>
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
    <section>
      {/* A LIST IS A SECTION, not a boxed card in a grid of boxed cards. The header carries the name,
          how many are in use, and the two things you can do to the list itself. */}
      <div className="v2-head">
        {renaming ? (
          <input
            value={listLabel} onChange={(e) => setListLabel(e.target.value)} autoFocus
            aria-label="List name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setRenaming(false); if (listLabel.trim() && listLabel !== list.label) call(() => fetch(`/api/orders/options/lists/${list.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: listLabel }) })) }
              if (e.key === 'Escape') { setListLabel(list.label); setRenaming(false) }
            }}
            onBlur={() => { setRenaming(false); setListLabel(list.label) }}
            className="v2-finput"
            style={{ flex: 1, minWidth: 0, minHeight: 32 }}
          />
        ) : (
          <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />{list.label}</p>
        )}
        <s />
        <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>{options.filter((o) => o.active).length} in use</span>
        <button onClick={() => setRenaming(true)} disabled={busy} className="v2-ico" title="Rename this list" aria-label={`Rename ${list.label}`}><Pencil /></button>
        {/* The inline two-step, kept: it deletes one dropdown list and no order that ever used it,
            which is not the weight the modal is for. */}
        {confirmDeleteList ? (
          <span className="flex items-center gap-1.5 flex-none">
            <button onClick={() => call(() => fetch(`/api/orders/options/lists/${list.id}`, { method: 'DELETE' }))} className="v2-act" data-solid data-danger>Delete list</button>
            <button onClick={() => setConfirmDeleteList(false)} className="v2-act">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDeleteList(true)} disabled={busy} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} title="Delete this whole list" aria-label={`Delete the ${list.label} list`}><Trash2 /></button>
        )}
      </div>

      <ul className="v2-list">
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
        {!options.length && <li className="v2-row"><div className="v2-m"><p style={{ color: 'var(--v2-ink-45)' }}>Nothing here yet — add your first option below.</p></div></li>}
      </ul>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 16 }}>
        <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
          <label htmlFor={`ool-add-${list.id}`}>Add an option</label>
          <input
            id={`ool-add-${list.id}`}
            value={adding} onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder="e.g. Brushed brass"
          />
        </div>
        <button onClick={add} disabled={busy || !adding.trim()} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)', marginBottom: 4 }}>
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {err && <p className="v2-kick" style={{ color: 'var(--v2-red-ink)', marginTop: 10 }}>{err}</p>}
    </section>
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
    <li className="v2-row" style={{ ['--chan' as string]: option.active ? 'var(--v2-t3)' : 'var(--v2-mute)' }}>
      {/* Order matters in a dropdown, so the two arrows stay — stacked, at the row's head, where a
          drag handle would be. */}
      <span className="v2-ooarrows">
        <button onClick={() => onMove(-1)} disabled={!canMoveUp || busy} title="Move up" aria-label="Move up"><ArrowUp /></button>
        <button onClick={() => onMove(1)} disabled={!canMoveDown || busy} title="Move down" aria-label="Move down"><ArrowDown /></button>
      </span>

      {editing ? (
        <>
          <input
            value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            aria-label="Option name"
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(option.label); setEditing(false) } }}
            className="v2-finput" style={{ flex: 1, minWidth: 0, minHeight: 32 }}
          />
          <button onClick={commit} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-t3)' }} title="Save" aria-label="Save"><Check /></button>
          <button onClick={() => { setDraft(option.label); setEditing(false) }} className="v2-ico" title="Cancel" aria-label="Cancel"><X /></button>
        </>
      ) : (
        <>
          <div className="v2-m">
            <p><span className="truncate" style={option.active ? undefined : { textDecoration: 'line-through', color: 'var(--v2-mute)' }}>{option.label}</span></p>
          </div>
          <button onClick={() => setEditing(true)} disabled={busy} className="v2-ico" title="Rename" aria-label={`Rename ${option.label}`}><Pencil /></button>
          <button onClick={onToggle} disabled={busy} className="v2-ico" title={option.active ? 'Hide from new orders' : 'Show again'} aria-label={option.active ? `Hide ${option.label} from new orders` : `Show ${option.label} again`}>
            {option.active ? <Eye /> : <EyeOff />}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1.5 flex-none">
              <button onClick={onDelete} className="v2-act" data-solid data-danger>Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="v2-act">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} disabled={busy} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} title="Delete" aria-label={`Delete ${option.label}`}><Trash2 /></button>
          )}
        </>
      )}
    </li>
  )
}
