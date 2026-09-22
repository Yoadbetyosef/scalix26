'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2, Printer, Star, Upload, X } from 'lucide-react'
import { MAX_PHOTOS } from '@/lib/studio/sanitize'

/**
 * The staff editor that sits UNDER the customer's own page, on the same URL.
 *
 * It is rendered only when the server has already decided this session may edit this tenant
 * (lib/studio/viewer.ts). That decision is not repeated here and could not be trusted if it were —
 * a client component is markup, and its presence proves nothing. The real gate is the API: every
 * save goes to PATCH /api/studio/products/[id], which re-runs requireStudioTenant() and scopes the
 * write by tenant_id, so a crafted request from another business fails there whatever this renders.
 *
 * It writes ONLY photos, description and base_price. The PATCH is partial (sanitizeProductPatch),
 * so the fields this panel has no controls for — supplier, internal notes, fabric, status,
 * category — are not in the body and are not written. Editing the same product in the Studio form
 * and here cannot make the two editors erase each other.
 *
 * The QR is not its business: the token is the identity, nothing here can change it, and the print
 * link is the same /studio/<id>/print the catalog page uses.
 */
export function StaffEditPanel({
  productId, initialPhotos, initialDescription, initialPrice, publicUrl,
}: {
  productId: string
  initialPhotos: string[]
  initialDescription: string | null
  initialPrice: number | null
  publicUrl: string
}) {
  const [photos, setPhotos] = useState<string[]>(initialPhotos)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [priceText, setPriceText] = useState(initialPrice != null ? String(initialPrice) : '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const full = photos.length >= MAX_PHOTOS

  const change = (next: string[]) => { setPhotos(next.slice(0, MAX_PHOTOS)); setSaved(false) }
  const remove = (i: number) => change(photos.filter((_, n) => n !== i))
  const makeCover = (i: number) => { if (i > 0) change([photos[i], ...photos.filter((_, n) => n !== i)]) }
  function move(i: number, d: number) {
    const j = i + d
    if (j < 0 || j >= photos.length) return
    const next = [...photos]
    ;[next[i], next[j]] = [next[j], next[i]]
    change(next)
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setErr(null)
    const picked = Array.from(files).slice(0, Math.max(0, MAX_PHOTOS - photos.length))
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
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      if (added.length) change([...photos, ...added])
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    const trimmed = priceText.trim()
    const priceNum = trimmed === '' ? null : Number(trimmed)
    if (trimmed !== '' && (!Number.isFinite(priceNum as number) || (priceNum as number) < 0)) {
      setErr('Price must be a number of 0 or more — leave it empty if the piece is not priced yet.')
      return
    }
    setSaving(true); setErr(null); setSaved(false)
    try {
      // Only the three fields this panel owns. A partial PATCH — see sanitizeProductPatch.
      const res = await fetch(`/api/studio/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos, description: description.trim() || null, base_price: priceNum }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Save failed (${res.status}).`)
      setSaved(true)
      // Re-render the customer's half of this page from the server, so what staff check after
      // saving is the page a customer would now be shown — not this component's local state.
      window.location.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const label = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500'

  return (
    <section
      aria-label="Staff editing"
      className="mt-10 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 sm:p-5"
    >
      {/* Said plainly, because this panel is drawn on the page a customer sees. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">Staff only</span>
        <p className="text-sm text-amber-900">Customers scanning this code do not see this panel.</p>
      </div>

      {err && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /><p>{err}</p>
        </div>
      )}

      <div className="mb-5">
        <span className={label}>Photos · {photos.length} of {MAX_PHOTOS}</span>
        {photos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-3">
            {photos.map((url, i) => (
              <div key={`${url}-${i}`} className="w-24">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-24 w-24 rounded-lg border border-neutral-200 object-cover" />
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove photo ${i + 1}`}
                          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-600 shadow-sm">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                          aria-label={`Move photo ${i + 1} earlier`} title="Move earlier"
                          className="flex h-8 w-8 items-center justify-center rounded text-neutral-600 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" onClick={() => makeCover(i)} disabled={i === 0}
                          aria-label={i === 0 ? 'This is the cover' : `Make photo ${i + 1} the cover`} title={i === 0 ? 'Cover' : 'Make cover'}
                          className={`flex h-8 w-8 items-center justify-center rounded ${i === 0 ? 'text-amber-500' : 'text-neutral-600'}`}>
                    <Star className="h-4 w-4" fill={i === 0 ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === photos.length - 1}
                          aria-label={`Move photo ${i + 1} later`} title="Move later"
                          className="flex h-8 w-8 items-center justify-center rounded text-neutral-600 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
                <p className="text-center text-[11px] text-neutral-500">{i === 0 ? 'Cover' : `Photo ${i + 1}`}</p>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={full || uploading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 disabled:opacity-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : full ? `${MAX_PHOTOS} is the maximum` : 'Add photos'}
        </button>
        <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml"
               onChange={(e) => upload(e.target.files)} className="hidden" />
        <p className="mt-1.5 text-xs text-neutral-500">The cover is the first photo — it is what this page shows first.</p>
      </div>

      <div className="mb-5">
        <label htmlFor="staff-desc" className={label}>Description</label>
        <textarea id="staff-desc" rows={4} value={description}
                  onChange={(e) => { setDescription(e.target.value); setSaved(false) }}
                  placeholder="Materials, dimensions, finish…"
                  className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-[15px] text-neutral-900" />
      </div>

      <div className="mb-5 max-w-xs">
        <label htmlFor="staff-price" className={label}>Price</label>
        <input id="staff-price" type="number" step="0.01" min="0" inputMode="decimal" value={priceText}
               onChange={(e) => { setPriceText(e.target.value); setSaved(false) }}
               placeholder="Not priced yet"
               className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-[15px] text-neutral-900" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || uploading}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-neutral-900 px-5 text-[15px] font-semibold text-white disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save product'}
        </button>
        {saved && !saving && (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        {/* Printing is offered ONLY once there is something saved to print a tag for. */}
        <a href={`/studio/${productId}/print`} target="_blank" rel="noreferrer"
           className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800">
          <Printer className="h-4 w-4" /> Print customer QR
        </a>
      </div>

      <p className="mt-3 break-all text-xs text-neutral-500">
        This page: {publicUrl} — the code never changes when you edit the product.
      </p>
    </section>
  )
}
