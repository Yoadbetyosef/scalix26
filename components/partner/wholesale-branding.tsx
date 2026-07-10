'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Panel } from '@/components/partner/ui'
import { Upload, Loader2, Globe, Check, Monitor, Mail, Phone } from 'lucide-react'

interface Brand {
  company_name: string; logo_url: string; favicon_url: string; primary_color: string; secondary_color: string
  support_email: string; support_phone: string; website: string; custom_domain: string; email_footer: string
  login_background_url: string; powered_by_scalix: boolean
}
const EMPTY: Brand = { company_name: '', logo_url: '', favicon_url: '', primary_color: '#5B6CF0', secondary_color: '#4338CA', support_email: '', support_phone: '', website: '', custom_domain: '', email_footer: '', login_background_url: '', powered_by_scalix: true }
const inp = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const lbl = 'mb-1 block text-xs font-medium text-subtle'

function UploadField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function upload(file: File) {
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/partner/marketing/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok || !j.url) return toast.error(j.error || 'Upload failed'); onChange(j.url)
  }
  return (
    <div>
      <label className={lbl}>{label}</label>
      <div className="flex gap-2">
        <input className={inp} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-subtle hover:text-ink">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}</button>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      </div>
    </div>
  )
}

export function WholesaleBranding({ appHost }: { appHost: string }) {
  const [b, setB] = useState<Brand>(EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof Brand, v: string | boolean) => setB((s) => ({ ...s, [k]: v }))

  useEffect(() => { fetch('/api/partner/brand').then((r) => r.json()).then((j) => { if (j.brand) setB({ ...EMPTY, ...Object.fromEntries(Object.entries(j.brand).filter(([, v]) => v != null)) }) }).catch(() => {}) }, [])

  async function save() {
    setSaving(true)
    const r = await fetch('/api/partner/brand', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    const j = await r.json().catch(() => ({})); setSaving(false)
    if (!r.ok) return toast.error(j.error || 'Could not save'); toast.success('Branding saved')
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Editor */}
      <div className="space-y-5">
        <Panel title="Brand identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className={lbl}>Company name</label><input className={inp} value={b.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="AIFlow" /></div>
            <UploadField label="Logo" value={b.logo_url} onChange={(v) => set('logo_url', v)} />
            <UploadField label="Favicon" value={b.favicon_url} onChange={(v) => set('favicon_url', v)} />
            <div><label className={lbl}>Primary color</label><input type="color" value={b.primary_color} onChange={(e) => set('primary_color', e.target.value)} className="h-10 w-full rounded-lg border border-hairline-strong" /></div>
            <div><label className={lbl}>Secondary color</label><input type="color" value={b.secondary_color} onChange={(e) => set('secondary_color', e.target.value)} className="h-10 w-full rounded-lg border border-hairline-strong" /></div>
          </div>
        </Panel>
        <Panel title="Support & footer">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Support email</label><input className={inp} value={b.support_email} onChange={(e) => set('support_email', e.target.value)} placeholder="support@yourbrand.com" /></div>
            <div><label className={lbl}>Support phone</label><input className={inp} value={b.support_phone} onChange={(e) => set('support_phone', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className={lbl}>Website</label><input className={inp} value={b.website} onChange={(e) => set('website', e.target.value)} placeholder="https://yourbrand.com" /></div>
            <div className="sm:col-span-2"><label className={lbl}>Email footer</label><input className={inp} value={b.email_footer} onChange={(e) => set('email_footer', e.target.value)} placeholder="© Your Company. All rights reserved." /></div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={b.powered_by_scalix} onChange={(e) => set('powered_by_scalix', e.target.checked)} /> Show “Powered by Scalix”</label>
        </Panel>
        <Panel title={<span className="inline-flex items-center gap-2"><Globe className="h-4 w-4 text-accent-strong" /> Custom domain</span>}>
          <div><label className={lbl}>Your domain</label><input className={inp} value={b.custom_domain} onChange={(e) => set('custom_domain', e.target.value)} placeholder="app.yourbrand.com" /></div>
          <UploadField label="Login background (optional)" value={b.login_background_url} onChange={(v) => set('login_background_url', v)} />
          <div className="mt-3 rounded-xl border border-hairline bg-canvas p-3 text-xs leading-relaxed text-subtle">
            <div className="mb-1 font-medium text-ink">Connect your domain</div>
            1. Add a <span className="font-mono text-ink">CNAME</span> record for <span className="font-mono text-ink">{b.custom_domain || 'app.yourbrand.com'}</span> pointing to <span className="font-mono text-ink">{appHost}</span>.<br />
            2. Save this page. Your brand loads automatically on that domain.<br />
            <span className="text-muted">SSL is issued automatically once DNS resolves.</span>
          </div>
        </Panel>
        <button onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-5 text-sm font-medium text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save branding</button>
      </div>

      {/* Live preview */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><Monitor className="h-3.5 w-3.5" /> Live preview</div>
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-e1" style={{ ['--brand' as string]: b.primary_color }}>
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            {b.logo_url ? <img src={b.logo_url} alt="logo" className="h-7 object-contain" /> : <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: b.primary_color }}>{(b.company_name || 'A')[0]}</span>}
            <span className="font-semibold text-ink">{b.company_name || 'Your Company'}</span>
          </div>
          <div className="space-y-3 p-5">
            <div className="text-sm font-semibold text-ink">Welcome to {b.company_name || 'Your Company'}</div>
            <p className="text-sm text-subtle">Your AI employee platform — every screen your clients see is yours.</p>
            <button className="h-9 rounded-lg px-4 text-sm font-medium text-white" style={{ background: b.primary_color }}>Create Business</button>
            <div className="flex flex-wrap gap-3 pt-1 text-xs text-subtle">
              {b.support_email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{b.support_email}</span>}
              {b.support_phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{b.support_phone}</span>}
            </div>
          </div>
          <div className="border-t border-hairline px-5 py-3 text-[11px] text-muted">
            {b.email_footer || `© ${new Date().getFullYear()} ${b.company_name || 'Your Company'}`}{b.powered_by_scalix && <span> · Powered by Scalix</span>}
          </div>
        </div>
        {b.login_background_url && <div className="mt-3 overflow-hidden rounded-xl border border-hairline"><img src={b.login_background_url} alt="login bg" className="h-28 w-full object-cover" /></div>}
      </div>
    </div>
  )
}
