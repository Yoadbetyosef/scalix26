'use client'

import { cloneElement, isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus, Star, Upload, X } from 'lucide-react'
import { STUDIO_PRODUCT_STATUSES, STUDIO_STATUS_LABELS, type StudioProduct } from '@/lib/studio/types'
import { MAX_PHOTOS } from '@/lib/studio/sanitize'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'

export type ProductInput = Partial<StudioProduct>

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  // Same shape as the catalogue's: .v2-fld needs the label and the control as SIBLINGS, and the id
  // is cloned onto the child so the caption still points at the control it names.
  const id = 'sp-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const child = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children
  return (
    <div className={wide ? 'v2-fld wide' : 'v2-fld'}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && <span className="v2-hint">{hint}</span>}
    </div>
  )
}

export function ProductForm({ initial, onSubmit, submitLabel }: { initial?: Partial<StudioProduct>; onSubmit: (p: Record<string, unknown>) => Promise<void>; submitLabel: string }) {
  const [f, setF] = useState<ProductInput>({
    name: '', category: '', description: '', base_price: null, status: 'active',
    photos: [], supplier_name: '', supplier_email: '', internal_notes: '', ...initial,
  })
  const [fabric, setFabric] = useState<FabricValue>({
    fabric_category: initial?.fabric_category ?? null, fabric_family: initial?.fabric_family ?? null,
    fabric_name: initial?.fabric_name ?? null, fabric_composition: initial?.fabric_composition ?? null,
    fabric_durability: initial?.fabric_durability ?? null,
  })
  const [photoDraft, setPhotoDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (k: keyof ProductInput, v: unknown) => { setSaved(false); setF((p) => ({ ...p, [k]: v })) }
  const photos = f.photos || []
  const full = photos.length >= MAX_PHOTOS

  // Any edit clears a stale "Saved" tick — it must never describe a state the form has moved past.
  const touch = () => setSaved(false)
  const setPhotos = (next: string[]) => { set('photos', next.slice(0, MAX_PHOTOS)); touch() }

  function addPhoto() {
    const url = photoDraft.trim()
    if (!url || full) return
    setPhotos([...photos, url]); setPhotoDraft('')
  }
  const removePhoto = (i: number) => setPhotos(photos.filter((_, idx) => idx !== i))
  /** Move a photo one place along. photos[0] IS the cover, so this is also how the cover changes. */
  function movePhoto(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= photos.length) return
    const next = [...photos]
    ;[next[i], next[j]] = [next[j], next[i]]
    setPhotos(next)
  }
  /** Promote to cover — a move to the front that keeps the rest in their existing order. */
  const makePrimary = (i: number) => { if (i !== 0) setPhotos([photos[i], ...photos.filter((_, idx) => idx !== i)]) }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setErr(null)
    const room = MAX_PHOTOS - photos.length
    const picked = Array.from(files).slice(0, Math.max(0, room))
    if (files.length > picked.length) setErr(`Only ${MAX_PHOTOS} photos per product — ${files.length - picked.length} not added.`)
    const added: string[] = []
    try {
      for (const file of picked) {
        const body = new FormData(); body.append('file', file)
        const res = await fetch('/api/studio/upload', { method: 'POST', body })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || `Could not upload ${file.name}.`)
        if (d.url) added.push(d.url)
      }
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      if (added.length) setPhotos([...photos, ...added])
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Validate the price BEFORE the request, so a typo is a sentence under the field rather than a
    // silent null from the server's sanitizer. The server still rejects it independently.
    const raw = f.base_price as unknown as string
    const hasPrice = raw !== '' && raw !== null && raw !== undefined
    const priceNum = hasPrice ? Number(raw) : null
    if (hasPrice && (!Number.isFinite(priceNum as number) || (priceNum as number) < 0)) {
      setErr('Base price must be a number of 0 or more — leave it empty if the piece is not priced yet.')
      return
    }
    setBusy(true); setErr(null); setSaved(false)
    try {
      await onSubmit({
        name: f.name, category: f.category, description: f.description,
        base_price: priceNum,
        status: f.status, photos,
        supplier_name: f.supplier_name, supplier_email: f.supplier_email, internal_notes: f.internal_notes,
        ...fabric,
      })
      setSaved(true)
    } catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 30 }}>
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
          <span className="v2-chip-sq"><X /></span><p>{err}</p>
        </div>
      )}

      {/* The essentials — this is all most products need. */}
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />The essentials</p><s /></div>
        <div className="v2-form">
          <Field label="Name" wide><input required value={f.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Halden Lounge Chair" /></Field>
          <Field label="Collection" hint="Optional — groups products"><input value={f.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Nordic 2026" /></Field>
          <Field label="Base price"><input type="number" step="0.01" value={f.base_price ?? ''} onChange={(e) => set('base_price', e.target.value)} placeholder="0.00" /></Field>
          <Field label="Details / spec" wide><textarea rows={3} value={f.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Materials, dimensions, finish…" /></Field>
        </div>
      </section>

      {/* Fabric (default for the product; sub-products can override) */}
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Fabric</p><s /></div>
        <FabricPicker value={fabric} onChange={setFabric} />
      </section>

      {/* Photos. The frames are the media block's, so what you are adding looks like what the list
          and the product page will show — and the first one is marked, because it is the cover. */}
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Photos{photos.length ? ` · ${photos.length}` : ''}</p><s /></div>
        {photos.length > 0 && (
          <div className="v2-shots" style={{ gap: 14, marginBottom: 20 }}>
            {photos.map((url, i) => (
              <div key={`${url}-${i}`} className="v2-shot" style={{ ['--shot' as string]: '80px', position: 'relative' }}>
                <b>{i === 0 ? 'Cover' : `Photo ${i + 1}`}</b>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" />
                <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`} className="v2-ico"
                        style={{ ['--ghue' as string]: 'var(--v2-red)', position: 'absolute', right: -8, top: 14, background: 'var(--v2-paper)' }}><X /></button>
                {/* Order and cover, on the photo they act on. photos[0] is the cover, so "make cover"
                    and the arrows are the same operation seen from two angles. */}
                <span className="v2-bar" style={{ gap: 4, marginTop: 6 }}>
                  <button type="button" onClick={() => movePhoto(i, -1)} disabled={i === 0}
                          aria-label={`Move photo ${i + 1} earlier`} title="Move earlier" className="v2-ico"><ChevronLeft /></button>
                  <button type="button" onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1}
                          aria-label={`Move photo ${i + 1} later`} title="Move later" className="v2-ico"><ChevronRight /></button>
                  <button type="button" onClick={() => makePrimary(i)} disabled={i === 0}
                          aria-label={`Make photo ${i + 1} the cover`} title="Make cover" className="v2-ico"
                          style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><Star /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="sp-photo">Add a photo</label>
            <input id="sp-photo" value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhoto() } }}
                   disabled={full}
                   placeholder={full ? `${MAX_PHOTOS} photos is the maximum` : 'Paste an image URL'} />
          </div>
          <button type="button" onClick={addPhoto} disabled={full || !photoDraft.trim()} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t1)', marginBottom: 4 }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
          {/* Upload, because pasting a URL is how every one of this tenant's photos ended up on a
              third-party host. The file goes to the tenant's own folder in the public catalog-images
              bucket and comes back as a stable URL — the same endpoint the branding modal uses. */}
          <button type="button" onClick={() => fileRef.current?.click()} disabled={full || uploading}
                  className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)', marginBottom: 4 }}>
            <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple
                 onChange={(e) => uploadFiles(e.target.files)} style={{ display: 'none' }} />
        </div>
        <span className="v2-hint" style={{ display: 'block', marginTop: 8 }}>
          {photos.length} of {MAX_PHOTOS}. The first is the cover — it is what the catalogue, the
          documents and the customer&rsquo;s scanned page all show first.
        </span>
      </section>

      {/* Optional — supplier (used later by "Send to production") + status + internal notes */}
      <details>
        <summary>
          <div className="v2-head" style={{ marginBottom: 0 }}>
            <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />More — supplier, status, notes</p>
            <s />
            <ChevronRight className="v2-fold-mark" />
          </div>
        </summary>
        <div className="v2-form" style={{ marginTop: 22 }}>
          <Field label="Supplier name"><input value={f.supplier_name || ''} onChange={(e) => set('supplier_name', e.target.value)} /></Field>
          <Field label="Supplier email"><input type="email" value={f.supplier_email || ''} onChange={(e) => set('supplier_email', e.target.value)} placeholder="factory@example.com" /></Field>
          <Field label="Status">
            <span className="v2-sel">
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>{STUDIO_PRODUCT_STATUSES.map((st) => <option key={st} value={st}>{STUDIO_STATUS_LABELS[st]}</option>)}</select>
            </span>
          </Field>
          <Field label="Internal notes — staff only" wide><textarea rows={2} value={f.internal_notes || ''} onChange={(e) => set('internal_notes', e.target.value)} /></Field>
        </div>
      </details>

      <div className="v2-savebar" data-pin>
        <button type="submit" disabled={busy || uploading} className="v2-act tap-target" data-solid data-wide style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
          {busy ? 'Saving…' : uploading ? 'Waiting for the upload…' : submitLabel}
        </button>
        {saved && !busy && (
          <span role="status" className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)', marginLeft: 10 }}>Saved</span>
        )}
      </div>
    </form>
  )
}
