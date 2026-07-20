'use client'

import { useEffect, useState } from 'react'
import { Upload, Check, Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Branding { logo_url: string | null; business_name: string; address: string | null; phone: string | null; email: string | null; website: string | null; accent_color: string; header_style: string; footer_text: string | null; intro: string | null; default_terms: string | null; default_email_subject: string | null; default_email_message: string | null }
const HEADERS = [{ v: 'standard', l: 'Standard (logo left)' }, { v: 'centered', l: 'Centered' }, { v: 'band', l: 'Color band' }]

// Structured, reliable proposal branding controls (no drag-and-drop). Fields map 1:1 to what the public
// proposal + email render. Saved to proposal_branding (tenant-scoped).
export function ProposalBrandingSettings() {
  const [b, setB] = useState<Branding | null>(null)
  const [save, setSave] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [uploading, setUploading] = useState(false)

  useEffect(() => { fetch('/api/core/proposals/branding').then((r) => r.json()).then((d) => setB(d.branding)).catch(() => setB(null)) }, [])

  async function put(patch: Record<string, unknown>) {
    setSave('saving')
    const res = await fetch('/api/core/proposals/branding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) { setSave('saved'); setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 1500) } else { setSave('idle'); toast.error('Could not save branding.') }
  }
  const field = (k: keyof Branding) => (v: string | null) => { setB((s) => (s ? { ...s, [k]: v } : s)); put({ [k]: v }) }
  async function onLogo(file: File | null) {
    if (!file) return
    setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    const up = await fetch('/api/core/uploads', { method: 'POST', body: fd }); const ud = await up.json().catch(() => ({}))
    setUploading(false)
    if (!up.ok || !ud.url) { toast.error(ud.error || 'Upload failed.'); return }
    field('logo_url')(ud.url)
  }

  if (!b) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-medium text-ink">Proposal branding</h2><p className="text-xs text-muted">Shown on every proposal you send and on the customer page.</p></div>
        {save === 'saving' ? <span className="inline-flex items-center gap-1 text-xs text-subtle"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span> : save === 'saved' ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3 w-3" /> Saved</span> : null}
      </div>

      <div className="flex items-center gap-4">
        {b.logo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={b.logo_url} alt="" className="h-14 max-w-[160px] rounded-lg border border-hairline object-contain p-1" />
          : <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-sunken text-xs text-muted">Logo</span>}
        <div className="flex gap-2">
          <label className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'cursor-pointer', uploading && 'pointer-events-none opacity-60')}><Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload logo'}<input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0] ?? null)} /></label>
          {b.logo_url && <Button size="sm" variant="ghost" onClick={() => field('logo_url')(null)}>Remove</Button>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Business name"><Input defaultValue={b.business_name} onBlur={(e) => field('business_name')(e.target.value.trim() || null)} /></F>
        <F label="Accent color"><div className="flex items-center gap-2"><input type="color" defaultValue={b.accent_color} onChange={(e) => field('accent_color')(e.target.value)} className="h-9 w-12 rounded border border-hairline" /><Input defaultValue={b.accent_color} onBlur={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && field('accent_color')(e.target.value)} /></div></F>
        <F label="Phone"><Input defaultValue={b.phone ?? ''} onBlur={(e) => field('phone')(e.target.value.trim() || null)} /></F>
        <F label="Email"><Input defaultValue={b.email ?? ''} onBlur={(e) => field('email')(e.target.value.trim() || null)} /></F>
        <F label="Website"><Input defaultValue={b.website ?? ''} onBlur={(e) => field('website')(e.target.value.trim() || null)} /></F>
        <F label="Header style"><select defaultValue={b.header_style} onChange={(e) => field('header_style')(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none">{HEADERS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}</select></F>
        <div className="sm:col-span-2"><F label="Business address"><Textarea defaultValue={b.address ?? ''} rows={2} onBlur={(e) => field('address')(e.target.value.trim() || null)} /></F></div>
        <div className="sm:col-span-2"><F label="Footer text"><Input defaultValue={b.footer_text ?? ''} onBlur={(e) => field('footer_text')(e.target.value.trim() || null)} /></F></div>
        <div className="sm:col-span-2"><F label="Default customer intro"><Textarea defaultValue={b.intro ?? ''} rows={2} onBlur={(e) => field('intro')(e.target.value.trim() || null)} placeholder="Prefilled on new proposals" /></F></div>
        <div className="sm:col-span-2"><F label="Default terms & conditions"><Textarea defaultValue={b.default_terms ?? ''} rows={3} onBlur={(e) => field('default_terms')(e.target.value.trim() || null)} /></F></div>
        <F label="Default email subject"><Input defaultValue={b.default_email_subject ?? ''} onBlur={(e) => field('default_email_subject')(e.target.value.trim() || null)} /></F>
        <F label="Default email message"><Textarea defaultValue={b.default_email_message ?? ''} rows={2} onBlur={(e) => field('default_email_message')(e.target.value.trim() || null)} /></F>
      </div>
    </div>
  )
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>
}
