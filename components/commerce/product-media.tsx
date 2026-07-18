'use client'

import { useEffect, useState } from 'react'
import { ImagePlus, Image as ImageIcon, Video, FileText, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface Media { id: string; url: string; kind: string; alt: string | null }

export function ProductMedia({ productId, primaryUrl, onSetPrimary }: { productId: string; primaryUrl: string | null; onSetPrimary: (url: string) => Promise<void> }) {
  const [media, setMedia] = useState<Media[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = () => fetch(`/api/core/products/${productId}/media`).then((r) => r.json()).then((d) => setMedia(d.media ?? [])).catch(() => setMedia([]))
  useEffect(() => { load() }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    const res = await fetch(`/api/core/media/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Media removed.'); load() } else toast.error('Could not remove media.')
  }

  if (!media) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Images, video and files for this product. The primary image is used across your catalog.</p>
        <Button size="sm" onClick={() => setAdding(true)}><ImagePlus className="h-4 w-4" /> Add media</Button>
      </div>

      {media.length === 0 ? (
        <EmptyState icon={ImageIcon} title="No media yet" action={<Button size="sm" onClick={() => setAdding(true)}><ImagePlus className="h-4 w-4" /> Add media</Button>}>
          Add product images by URL. Set one as the primary image to show it across the catalog.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((m) => {
            const isPrimary = !!primaryUrl && m.url === primaryUrl
            return (
              <li key={m.id} className="group relative overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
                <div className="flex aspect-square items-center justify-center bg-sunken">
                  {m.kind === 'image'
                    ? // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={m.alt || ''} className="h-full w-full object-cover" />
                    : m.kind === 'video' ? <Video className="h-8 w-8 text-muted" /> : <FileText className="h-8 w-8 text-muted" />}
                </div>
                {isPrimary && <Badge variant="resolved" className="absolute left-2 top-2">Primary</Badge>}
                <div className="flex items-center justify-between gap-1 p-2">
                  <span className="truncate text-xs text-muted">{m.kind}</span>
                  <div className="flex items-center gap-1">
                    {m.kind === 'image' && !isPrimary && (
                      <button onClick={() => onSetPrimary(m.url).then(load)} className="flex h-7 w-7 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Set as primary" title="Set as primary"><Star className="h-4 w-4" /></button>
                    )}
                    <button onClick={() => remove(m.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-danger" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {adding && <AddMediaForm productId={productId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />}
    </div>
  )
}

function AddMediaForm({ productId, onClose, onDone }: { productId: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('image')
  const [alt, setAlt] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    if (!url.trim()) { toast.error('URL is required.'); return }
    setSaving(true)
    const res = await fetch(`/api/core/products/${productId}/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim(), kind, alt: alt.trim() || null }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success('Media added.'); onDone() } else toast.error(d.error || 'Could not add media.')
  }
  return (
    <Drawer open onClose={onClose} title="Add media"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Add</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>URL <span className="text-danger">*</span></Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={2000} /></div>
        <div className="space-y-1.5"><Label>Type</Label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
            <option value="image">Image</option><option value="video">Video</option><option value="file">File</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label>Alt text</Label><Input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Optional" maxLength={300} /></div>
      </div>
    </Drawer>
  )
}
