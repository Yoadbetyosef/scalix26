'use client'

import { useEffect, useState } from 'react'
import { Upload, Star, Trash2, ArrowLeft, ArrowRight, Image as ImageIcon, QrCode, Copy, Download, Printer, CheckCircle2, Link2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Media { id: string; url: string; kind: string; alt: string | null; sort_order: number }

// Direct image management for a component: upload from the user's computer (multipart → catalog-images
// bucket → product_media) OR paste an image URL — both save to the same media model. Set primary
// (component.image_url, reused on documents + the QR page), reorder and remove. The uploader uses a native
// <label>-wrapped file input so the picker reliably opens (incl. Safari); no duplicate media system.
export function ComponentImages({ componentId, primaryUrl, onChanged }: { componentId: string; primaryUrl: string | null; onChanged: () => void }) {
  const [media, setMedia] = useState<Media[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')

  const load = () => fetch(`/api/core/components/${componentId}/media`).then((r) => r.json()).then((d) => setMedia(d.media ?? [])).catch(() => setMedia([]))
  useEffect(() => { load() }, [componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addMedia = (u: string) => fetch(`/api/core/components/${componentId}/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u, kind: 'image' }) })

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    let first: string | null = null, done = 0
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append('file', file)
      const up = await fetch('/api/core/uploads', { method: 'POST', body: fd })
      const ud = await up.json().catch(() => ({}))
      if (!up.ok || !ud.url) { toast.error(ud.error || 'Upload failed.'); continue }
      await addMedia(ud.url); if (!first) first = ud.url; done++
    }
    if (first && !primaryUrl) await setPrimary(first)
    setBusy(false)
    if (done) { toast.success(done > 1 ? `${done} images uploaded.` : 'Image uploaded.'); load() }
  }
  async function addUrl() {
    const u = url.trim(); if (!u) { toast.error('Enter an image URL.'); return }
    const res = await addMedia(u)
    if (res.ok) { if (!primaryUrl) await setPrimary(u); setUrl(''); toast.success('Image added.'); load() } else toast.error('Could not add the image.')
  }
  async function setPrimary(u: string) {
    await fetch(`/api/core/components/${componentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageUrl: u }) })
    onChanged()
  }
  async function remove(m: Media) {
    await fetch(`/api/core/media/${m.id}`, { method: 'DELETE' })
    if (m.url === primaryUrl) { await fetch(`/api/core/components/${componentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageUrl: null }) }); onChanged() }
    load()
  }
  async function move(idx: number, dir: -1 | 1) {
    if (!media) return
    const arr = [...media]; const j = idx + dir; if (j < 0 || j >= arr.length) return
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    setMedia(arr)
    await fetch('/api/core/media/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: arr.map((m) => m.id) }) })
  }

  return (
    <div className="space-y-3">
      <label className={cn(buttonVariants({ size: 'sm' }), 'w-fit cursor-pointer', busy && 'pointer-events-none opacity-60')}>
        <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload from computer'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy} className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl() } }} placeholder="…or paste an image URL" maxLength={2000} className="pl-9" />
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!url.trim()} onClick={addUrl}>Add URL</Button>
      </div>
      <p className="text-xs text-muted">JPG, PNG, WEBP or GIF · up to 10MB each. The primary image is used on documents and the QR page.</p>

      {!media ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}</div>
        : media.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-hairline-strong py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sunken text-muted"><ImageIcon className="h-5 w-5" /></span>
            <p className="text-sm text-muted">No images yet — upload one or paste a URL to get started.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {media.map((m, i) => {
              const isPrimary = !!primaryUrl && m.url === primaryUrl
              return (
                <li key={m.id} className={cn('group relative overflow-hidden rounded-card border bg-sunken', isPrimary ? 'border-accent' : 'border-hairline')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt || ''} className="aspect-square w-full object-cover" />
                  {isPrimary && <Badge variant="resolved" className="absolute left-1 top-1">Primary</Badge>}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-white/90 p-1">
                    <div className="flex">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move left"><ArrowLeft className="h-4 w-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === media.length - 1} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move right"><ArrowRight className="h-4 w-4" /></button>
                    </div>
                    <div className="flex">
                      {!isPrimary && <button onClick={() => setPrimary(m.url)} className="text-muted hover:text-accent-strong" aria-label="Set as primary" title="Set as primary"><Star className="h-4 w-4" /></button>}
                      <button onClick={() => remove(m)} className="text-muted hover:text-danger" aria-label="Remove image"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}

// QR panel: name, rendered QR, public URL, copy, download, print, and public-page status. Works for any QR
// endpoint (component or variant) — both return the same shape.
export function ComponentQR({ componentId }: { componentId: string }) {
  return <QrPanel endpoint={`/api/core/components/${componentId}/qr`} />
}
export function QrPanel({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<{ name: string; publicUrl: string; dataUrl: string; active: boolean } | null>(null)
  useEffect(() => { fetch(endpoint).then((r) => r.json()).then(setData).catch(() => setData(null)) }, [endpoint])

  function print() {
    if (!data) return
    const w = window.open('', '_blank', 'width=420,height=520')
    if (!w) return
    w.document.write(`<html><head><title>${data.name} — QR</title></head><body style="font-family:sans-serif;text-align:center;padding:24px"><h3>${data.name}</h3><img src="${data.dataUrl}" style="width:320px;height:320px"/><p style="font-size:12px;color:#555">${data.publicUrl}</p><script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  if (!data) return <div className="space-y-3"><Skeleton className="mx-auto h-56 w-56" /><Skeleton className="h-9 w-full" /></div>
  return (
    <div className="space-y-4 text-center">
      <p className="text-sm font-medium text-ink">{data.name}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.dataUrl} alt="QR code" className="mx-auto h-56 w-56 rounded-card border border-hairline" />
      <div className="flex items-center justify-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-4 w-4" /> Public page is active</div>
      <div className="rounded-input border border-hairline bg-sunken px-3 py-2 text-left"><p className="truncate text-xs text-subtle">{data.publicUrl}</p></div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(data.publicUrl); toast.success('Link copied.') }}><Copy className="h-4 w-4" /> Copy link</Button>
        <a href={data.dataUrl} download={`${data.name.replace(/\s+/g, '-')}-qr.png`} className="inline-flex h-11 items-center gap-2 rounded-button border border-hairline-strong bg-white px-3 text-sm text-ink shadow-e1 hover:bg-sunken"><Download className="h-4 w-4" /> Download</a>
        <Button size="sm" variant="outline" onClick={print}><Printer className="h-4 w-4" /> Print</Button>
        <a href={data.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-button px-3 text-sm text-accent-strong hover:underline"><QrCode className="h-4 w-4" /> Open page</a>
      </div>
    </div>
  )
}
