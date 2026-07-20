'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Upload, Image as ImageIcon, Layers } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTerminology } from '@/lib/hooks/use-terminology'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Material { id: string; name: string; code: string | null; image_url: string | null; color: string | null; composition: string | null; martindale: string | null; width: string | null; weight: string | null; notes: string | null; status: string }
export const MATERIAL_STATUS: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  in_stock: { label: 'In stock', variant: 'active' }, low_stock: { label: 'Low stock', variant: 'pending' }, out_of_stock: { label: 'Out of stock', variant: 'closed' }, discontinued: { label: 'Discontinued', variant: 'neutral' },
}
const STATUSES = Object.keys(MATERIAL_STATUS)

export function MaterialsList() {
  const { term } = useTerminology()
  const one = term('material', { fallback: 'Material' }), many = term('material', { plural: true, fallback: 'Materials' })
  const [rows, setRows] = useState<Material[] | null>(null)
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('')
  const [editing, setEditing] = useState<Material | 'new' | null>(null)

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('search', search.trim())
    if (statusF) p.set('status', statusF)
    fetch(`/api/core/materials?${p.toString()}`).then((r) => r.json()).then((d) => setRows(d.materials ?? [])).catch(() => setRows([]))
  }, [search, statusF])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  async function del(m: Material) {
    if (!confirm(`Delete "${m.name}"? Proposals/orders that already used it keep their saved copy.`)) return
    const r = await fetch(`/api/core/materials/${m.id}`, { method: 'DELETE' })
    if (r.ok) { toast.success(`${one} deleted.`); load() } else toast.error('Could not delete.')
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between">
        <div><h1 className="text-xl font-light tracking-tight text-ink">{many}</h1><p className="mt-0.5 text-xs text-muted">A simple library of {many.toLowerCase()} you can attach to products and pick on proposals.</p></div>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add {one.toLowerCase()}</Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, color…" className="pl-9" /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="h-11 rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{MATERIAL_STATUS[s].label}</option>)}</select>
      </div>

      {!rows ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
        : rows.length === 0 ? (
          <EmptyState icon={Layers} title={search || statusF ? 'No matches' : `No ${many.toLowerCase()} yet`} action={<Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add {one.toLowerCase()}</Button>}>
            {search || statusF ? 'Try a different search or filter.' : `Add ${many.toLowerCase()} with a photo, code and status — then attach them to products.`}
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rows.map((m) => {
              const st = MATERIAL_STATUS[m.status] ?? { label: m.status, variant: 'neutral' as const }
              return (
                <li key={m.id} className="group overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
                  <div className="relative aspect-square bg-sunken">
                    {m.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={m.image_url} alt="" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-muted"><ImageIcon className="h-8 w-8" /></span>}
                    <div className="absolute left-1.5 top-1.5"><Badge variant={st.variant}>{st.label}</Badge></div>
                    <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setEditing(m)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-subtle hover:text-ink" aria-label="Quick edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => del(m)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-subtle hover:text-danger" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                    <p className="truncate text-xs text-muted">{[m.code, m.color].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

      {editing && <MaterialForm term={one} material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function MaterialForm({ term, material, onClose, onSaved }: { term: string; material: Material | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: material?.name ?? '', code: material?.code ?? '', color: material?.color ?? '', composition: material?.composition ?? '', martindale: material?.martindale ?? '', width: material?.width ?? '', weight: material?.weight ?? '', notes: material?.notes ?? '', status: material?.status ?? 'in_stock' })
  const [image, setImage] = useState<string | null>(material?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function onFile(file: File | null) {
    if (!file) return
    setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    const up = await fetch('/api/core/uploads', { method: 'POST', body: fd }); const ud = await up.json().catch(() => ({}))
    setUploading(false)
    if (!up.ok || !ud.url) { toast.error(ud.error || 'Upload failed.'); return }
    setImage(ud.url)
  }
  async function save() {
    if (!f.name.trim()) { toast.error('Name is required.'); return }
    setSaving(true)
    const body = { ...f, image_url: image }
    const res = material ? await fetch(`/api/core/materials/${material.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/core/materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success(material ? `${term} saved.` : `${term} added.`); onSaved() } else toast.error(d.error || 'Could not save.')
  }

  return (
    <Drawer open onClose={onClose} title={material ? `Edit ${term.toLowerCase()}` : `Add ${term.toLowerCase()}`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>{material ? 'Save' : 'Add'}</Button></div>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={image} alt="" className="h-16 w-16 rounded-lg border border-hairline object-cover" />
            : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-sunken text-muted"><ImageIcon className="h-6 w-6" /></span>}
          <div className="flex gap-2">
            <label className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'cursor-pointer', uploading && 'pointer-events-none opacity-60')}><Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload image'}<input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></label>
            {image && <Button size="sm" variant="ghost" onClick={() => setImage(null)}>Remove</Button>}
          </div>
        </div>
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={f.name} onChange={set('name')} placeholder="e.g. Impala Jungle 207" maxLength={200} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Code</Label><Input value={f.code} onChange={set('code')} maxLength={100} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label>Color</Label><Input value={f.color} onChange={set('color')} maxLength={100} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label>Composition</Label><Input value={f.composition} onChange={set('composition')} maxLength={500} placeholder="e.g. 100% Polyester" /></div>
          <div className="space-y-1.5"><Label>Martindale</Label><Input value={f.martindale} onChange={set('martindale')} maxLength={100} placeholder="e.g. 40,000" /></div>
          <div className="space-y-1.5"><Label>Width</Label><Input value={f.width} onChange={set('width')} maxLength={100} placeholder="e.g. 140 cm" /></div>
          <div className="space-y-1.5"><Label>Weight</Label><Input value={f.weight} onChange={set('weight')} maxLength={100} placeholder="e.g. 320 g/m²" /></div>
        </div>
        <div className="space-y-1.5"><Label>Status</Label><select value={f.status} onChange={set('status')} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">{STATUSES.map((s) => <option key={s} value={s}>{MATERIAL_STATUS[s].label}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={set('notes')} rows={2} maxLength={4000} placeholder="Optional" /></div>
      </div>
    </Drawer>
  )
}
