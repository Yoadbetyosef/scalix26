'use client'

import { useEffect, useState } from 'react'
import { Package as PackageIcon, SlidersHorizontal, Type, Hash, Plus, Check, Tag, ArrowUp, ArrowDown, Archive, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs } from '@/components/ui/tabs'
import { SectionNav } from '@/components/commerce/section-nav'
import { toast } from 'sonner'

const TABS = [
  { key: 'packages', label: 'Packages', icon: PackageIcon },
  { key: 'categories', label: 'Categories', icon: Tag },
  { key: 'fields', label: 'Custom fields', icon: SlidersHorizontal },
  { key: 'terminology', label: 'Terminology', icon: Type },
  { key: 'numbering', label: 'Numbering', icon: Hash },
]

export function ConfigView() {
  const [tab, setTab] = useState('packages')
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6"><h1 className="text-2xl font-light tracking-tight text-ink">Settings</h1><p className="mt-1 text-sm text-muted">Configure your industry package, custom fields, wording and document numbering.</p></header>
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />
      {tab === 'packages' && <Packages />}
      {tab === 'categories' && <Categories />}
      {tab === 'fields' && <Fields />}
      {tab === 'terminology' && <Terminology />}
      {tab === 'numbering' && <Numbering />}
    </div>
  )
}

// ── Packages ────────────────────────────────────────────────────────────────
function Packages() {
  const [data, setData] = useState<{ available: { key: string; name: string; version: number; description: string | null; fieldCount: number }[]; installed: { key: string; installedVersion: number; upgradeAvailable: boolean }[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => fetch('/api/core/packages').then((r) => r.json()).then(setData).catch(() => setData({ available: [], installed: [] }))
  useEffect(() => { load() }, [])

  async function act(packageKey: string, method: 'POST' | 'DELETE') {
    setBusy(packageKey)
    const res = await fetch('/api/core/packages/install', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packageKey }) })
    setBusy(null)
    if (res.ok) { toast.success(method === 'POST' ? 'Package installed.' : 'Package removed.'); load() } else toast.error('Action failed.')
  }

  if (!data) return <SkeletonRows />
  const installedByKey = new Map(data.installed.map((i) => [i.key, i]))
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Installing a package adds its industry fields to your products. A jewelry tenant that installs only Jewelry receives no furniture fields. Uninstalling keeps your data.</p>
      {data.available.length === 0 ? <p className="py-8 text-center text-sm text-muted">No packages available.</p> : data.available.map((p) => {
        const inst = installedByKey.get(p.key)
        return (
          <div key={p.key} className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-4 shadow-e1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="font-medium text-ink">{p.name}</span>{inst && <Badge variant="active">Installed v{inst.installedVersion}</Badge>}</div>
              <p className="truncate text-xs text-muted">{p.description} · {p.fieldCount} fields</p>
            </div>
            {inst
              ? <div className="flex gap-2">{inst.upgradeAvailable && <Button size="sm" loading={busy === p.key} onClick={() => act(p.key, 'POST')}>Upgrade</Button>}<Button size="sm" variant="outline" loading={busy === p.key} onClick={() => act(p.key, 'DELETE')}>Uninstall</Button></div>
              : <Button size="sm" loading={busy === p.key} onClick={() => act(p.key, 'POST')}><Plus className="h-4 w-4" /> Install</Button>}
          </div>
        )
      })}
    </div>
  )
}

// ── Custom fields ─────────────────────────────────────────────────────────────
const ENTITY_TYPES = ['product', 'variant', 'component', 'contact', 'company']
const FIELD_TYPES = ['text', 'long_text', 'integer', 'decimal', 'money', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'file', 'image']
interface Def { id: string; entity_type: string; key: string; label: string; field_type: string; required: boolean; active: boolean; source_package_id: string | null; options?: { value: string; label: string }[] }

function Fields() {
  const [entity, setEntity] = useState('product')
  const [defs, setDefs] = useState<Def[] | null>(null)
  const [adding, setAdding] = useState(false)
  const load = () => fetch(`/api/core/field-definitions?entity_type=${entity}`).then((r) => r.json()).then((d) => setDefs(d.definitions ?? [])).catch(() => setDefs([]))
  useEffect(() => { load() }, [entity]) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/core/field-definitions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) load(); else toast.error('Could not update the field.')
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="h-10 rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)} fields</option>)}
        </select>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add field</Button>
      </div>
      {!defs ? <SkeletonRows /> : defs.length === 0 ? <p className="py-8 text-center text-sm text-muted">No custom fields for {entity} yet.</p> : (
        <ul className="space-y-2">
          {defs.map((d) => (
            <li key={d.id} className="rounded-card border border-hairline bg-surface p-3 shadow-e1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium text-ink">{d.label}</span>{d.source_package_id && <Badge variant="resolved">Package</Badge>}</div><p className="text-xs text-muted">{d.key} · {d.field_type}</p></div>
                <label className="flex items-center gap-1.5 text-xs text-subtle"><input type="checkbox" checked={d.required} onChange={(e) => patch(d.id, { required: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" /> Required</label>
                <label className="flex items-center gap-1.5 text-xs text-subtle"><input type="checkbox" checked={d.active} onChange={(e) => patch(d.id, { active: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" /> Active</label>
              </div>
              {(d.field_type === 'select' || d.field_type === 'multi_select') && <OptionEditor def={d} onAdd={(value, label) => patch(d.id, { addOption: { value, label } })} />}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddFieldForm entity={entity} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />}
    </div>
  )
}

function OptionEditor({ def, onAdd }: { def: Def; onAdd: (value: string, label: string) => void }) {
  const [val, setVal] = useState('')
  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <div className="mb-1.5 flex flex-wrap gap-1.5">{(def.options ?? []).map((o) => <span key={o.value} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle">{o.label}</span>)}{!def.options?.length && <span className="text-xs text-muted">No options yet</span>}</div>
      <div className="flex gap-2"><Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Add option" className="h-9" /><Button size="sm" variant="outline" onClick={() => { if (val.trim()) { onAdd(val.trim().toLowerCase().replace(/\s+/g, '_'), val.trim()); setVal('') } }}><Check className="h-4 w-4" /></Button></div>
    </div>
  )
}

function AddFieldForm({ entity, onClose, onDone }: { entity: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(''); const [fieldType, setFieldType] = useState('text'); const [required, setRequired] = useState(false); const [saving, setSaving] = useState(false)
  async function save() {
    if (!label.trim()) { toast.error('Label is required.'); return }
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!key) { toast.error('Enter a valid label.'); return }
    setSaving(true)
    const res = await fetch('/api/core/field-definitions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityType: entity, key, label: label.trim(), fieldType, required }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success('Field added.'); onDone() } else toast.error(d.error || 'Could not add the field.')
  }
  return (
    <Drawer open onClose={onClose} title={`Add ${entity} field`} footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>Add</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Label <span className="text-danger">*</span></Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Warranty length" maxLength={200} /></div>
        <div className="space-y-1.5"><Label>Type</Label><select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Required</label>
      </div>
    </Drawer>
  )
}

// ── Terminology ───────────────────────────────────────────────────────────────
function Terminology() {
  const [terms, setTerms] = useState<Record<string, { singular: string; plural: string }> | null>(null)
  const load = () => fetch('/api/core/terminology').then((r) => r.json()).then((d) => setTerms(d.terminology ?? {})).catch(() => setTerms({}))
  useEffect(() => { load() }, [])
  async function save(nounKey: string, singular: string, plural: string) {
    const res = await fetch('/api/core/terminology', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nounKey, singular, plural }) })
    if (res.ok) { toast.success('Wording saved.'); load() } else toast.error('Could not save.')
  }
  if (!terms) return <SkeletonRows />
  return (
    <div className="space-y-2">
      <p className="mb-2 text-sm text-muted">Rename supported business nouns to match your industry. System actions (Save, Delete, Settings…) can never be renamed.</p>
      {Object.entries(terms).map(([k, v]) => <TermRow key={k} nounKey={k} singular={v.singular} plural={v.plural} onSave={save} />)}
    </div>
  )
}
function TermRow({ nounKey, singular, plural, onSave }: { nounKey: string; singular: string; plural: string; onSave: (k: string, s: string, p: string) => void }) {
  const [s, setS] = useState(singular); const [p, setP] = useState(plural)
  const dirty = s !== singular || p !== plural
  return (
    <div className="flex items-center gap-2 rounded-card border border-hairline bg-surface p-2 shadow-e1">
      <span className="w-24 shrink-0 truncate px-1 text-xs text-muted">{nounKey}</span>
      <Input value={s} onChange={(e) => setS(e.target.value)} className="h-9" placeholder="Singular" />
      <Input value={p} onChange={(e) => setP(e.target.value)} className="h-9" placeholder="Plural" />
      <Button size="sm" variant="outline" disabled={!dirty} onClick={() => onSave(nounKey, s, p)}>Save</Button>
    </div>
  )
}

// ── Numbering ─────────────────────────────────────────────────────────────────
interface Rule { doc_type: string; prefix: string; padding: number; next_number: number }
function Numbering() {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const load = () => fetch('/api/core/numbering').then((r) => r.json()).then((d) => setRules(d.rules ?? [])).catch(() => setRules([]))
  useEffect(() => { load() }, [])
  async function save(docType: string, prefix: string, padding: number) {
    const res = await fetch('/api/core/numbering', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docType, prefix, padding }) })
    if (res.ok) { toast.success('Numbering saved.'); load() } else toast.error('Could not save.')
  }
  if (!rules) return <SkeletonRows />
  if (rules.length === 0) return <p className="py-8 text-center text-sm text-muted">Numbering initializes automatically when you create your first estimate, quote or invoice.</p>
  return <div className="space-y-2"><p className="mb-2 text-sm text-muted">Customize the prefix and zero-padding for each document type.</p>{rules.map((r) => <NumRow key={r.doc_type} rule={r} onSave={save} />)}</div>
}
function NumRow({ rule, onSave }: { rule: Rule; onSave: (docType: string, prefix: string, padding: number) => void }) {
  const [prefix, setPrefix] = useState(rule.prefix); const [padding, setPadding] = useState(String(rule.padding))
  return (
    <div className="flex items-center gap-2 rounded-card border border-hairline bg-surface p-2 shadow-e1">
      <span className="w-20 shrink-0 truncate px-1 text-xs text-muted">{rule.doc_type}</span>
      <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-9" placeholder="Prefix" />
      <Input value={padding} onChange={(e) => setPadding(e.target.value)} className="h-9 w-20" type="number" min="1" max="10" />
      <span className="shrink-0 text-xs text-muted">next {rule.next_number}</span>
      <Button size="sm" variant="outline" onClick={() => onSave(rule.doc_type, prefix, Number(padding) || rule.padding)}>Save</Button>
    </div>
  )
}

// ── Categories ────────────────────────────────────────────────────────────────
interface Cat { id: string; name: string; group_label: string | null; sort_order: number; archived_at: string | null; source_package_id: string | null }
function Categories() {
  const [cats, setCats] = useState<Cat[] | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const load = () => fetch('/api/core/categories?archived=1').then((r) => r.json()).then((d) => setCats(d.categories ?? [])).catch(() => setCats([]))
  useEffect(() => { load() }, [])

  const active = (cats ?? []).filter((c) => !c.archived_at).sort((a, b) => a.sort_order - b.sort_order)
  const archived = (cats ?? []).filter((c) => c.archived_at)

  async function create() {
    const name = newName.trim(); if (!name) return
    const res = await fetch('/api/core/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setNewName(''); toast.success('Category added.'); load() } else toast.error(d.error === 'duplicate' ? 'That category already exists.' : 'Could not add.')
  }
  async function patch(id: string, body: Record<string, unknown>) { const res = await fetch(`/api/core/categories/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (res.ok) load(); else { const d = await res.json().catch(() => ({})); toast.error(d.error === 'duplicate' ? 'That name already exists.' : 'Could not update.') } }
  async function del(id: string) { const res = await fetch(`/api/core/categories/${id}`, { method: 'DELETE' }); if (res.ok) { toast.success('Category deleted.'); load() } else toast.error(res.status === 409 ? 'In use — archive it instead of deleting.' : 'Could not delete.') }
  async function move(idx: number, dir: -1 | 1) {
    const arr = [...active]; const j = idx + dir; if (j < 0 || j >= arr.length) return
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    setCats((prev) => prev ? [...arr, ...archived] : prev)
    await fetch('/api/core/categories/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: arr.map((c) => c.id) }) })
    load()
  }

  if (!cats) return <SkeletonRows />
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Categories power the product Category picker. They’re seeded by your installed package and you can add your own. Archived categories disappear from selection but stay on existing products.</p>
      <div className="flex items-center gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create() }} placeholder="New category name" className="h-10" />
        <Button size="sm" onClick={create}><Plus className="h-4 w-4" /> Add</Button>
      </div>

      {active.length === 0 ? <p className="py-6 text-center text-sm text-muted">No categories yet.</p> : (
        <ul className="space-y-1">
          {active.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-card border border-hairline bg-surface p-2 shadow-e1">
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(i, 1)} disabled={i === active.length - 1} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              {editing?.id === c.id ? (
                <input value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && editing.name.trim()) { patch(c.id, { name: editing.name.trim() }); setEditing(null) } }} autoFocus className="h-9 flex-1 rounded-input border border-hairline px-2 text-sm text-ink focus:border-ink/30 focus:outline-none" />
              ) : (
                <div className="min-w-0 flex-1"><span className="truncate text-sm text-ink">{c.name}</span>{c.group_label && <span className="ml-2 text-xs text-muted">{c.group_label}</span>}{c.source_package_id && <Badge variant="resolved" className="ml-2">Package</Badge>}</div>
              )}
              {editing?.id === c.id
                ? <Button size="sm" variant="outline" onClick={() => { if (editing.name.trim()) { patch(c.id, { name: editing.name.trim() }); setEditing(null) } }}>Save</Button>
                : <>
                    <button onClick={() => setEditing({ id: c.id, name: c.name })} className="text-xs text-subtle hover:text-ink">Rename</button>
                    <button onClick={() => patch(c.id, { archived: true })} className="flex h-7 w-7 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Archive"><Archive className="h-4 w-4" /></button>
                  </>}
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Archived</h3>
          <ul className="space-y-1">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-card border border-hairline bg-sunken/40 p-2">
                <span className="min-w-0 flex-1 truncate text-sm text-subtle">{c.name}</span>
                <button onClick={() => patch(c.id, { archived: false })} className="flex h-7 w-7 items-center justify-center rounded-lg text-subtle hover:bg-white hover:text-ink" aria-label="Restore"><RotateCcw className="h-4 w-4" /></button>
                <button onClick={() => del(c.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-subtle hover:bg-white hover:text-danger" aria-label="Delete (only if unused)"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SkeletonRows() { return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> }
