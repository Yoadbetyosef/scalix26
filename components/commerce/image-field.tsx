'use client'

import { useRef, useState } from 'react'
import { Upload, X, Link2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

// Single primary-image field used by BOTH the Commerce product form and the legacy Catalog form. Supports
// upload-from-computer (multipart → the given endpoint → catalog-images bucket) AND paste-URL — both save
// the SAME image_url (no duplicate field/media system). Immediate preview, replace, remove.
export function ImageField({ value, onChange, uploadEndpoint = '/api/core/uploads' }: { value: string; onChange: (url: string) => void; uploadEndpoint?: string }) {
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File | null | undefined) {
    if (!file) return
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch(uploadEndpoint, { method: 'POST', body: fd })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && d.url) { onChange(d.url); toast.success('Image uploaded.') } else toast.error(d.error || 'Upload failed.')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <div className="flex items-center gap-3">
        {value
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-hairline object-cover" />
          : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-sunken text-[10px] text-muted">No image</span>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {value ? 'Replace' : 'Upload from computer'}</Button>
          {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}><X className="h-4 w-4" /> Remove</Button>}
          {value && <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent-strong"><Star className="h-3 w-3" /> Primary</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL" maxLength={2000} className="pl-9" />
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!url.trim()} onClick={() => { onChange(url.trim()); setUrl('') }}>Use URL</Button>
      </div>
      <p className="text-xs text-muted">JPG, PNG, WEBP or GIF · up to 10MB. Uploads and URLs both save to your product image.</p>
    </div>
  )
}
