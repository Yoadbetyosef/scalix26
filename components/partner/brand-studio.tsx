'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Upload, Mail, Phone, Bot, Sparkles, Building2, DollarSign } from 'lucide-react'

interface Brand {
  company_name: string; logo_url: string; favicon_url: string; primary_color: string; secondary_color: string
  support_email: string; support_phone: string; website: string; custom_domain: string; email_footer: string
  login_background_url: string; powered_by_scalix: boolean
}
const EMPTY: Brand = { company_name: '', logo_url: '', favicon_url: '', primary_color: '#5B6CF0', secondary_color: '#4338CA', support_email: '', support_phone: '', website: '', custom_domain: '', email_footer: '', login_background_url: '', powered_by_scalix: false }

const lbl = 'mb-1.5 block text-xs font-medium text-subtle'
const inp = 'h-10 w-full rounded-xl border border-hairline bg-surface px-3.5 text-sm text-ink outline-none transition-shadow focus:border-accent/40 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_10%,transparent)]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lbl}>{label}</label>{children}</div>
}

function UploadField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function pick(file: File) {
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/partner/marketing/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({})); setBusy(false)
    if (j.url) onChange(j.url); else toast.error('Upload failed')
  }
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input className={inp} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" />
        <button type="button" onClick={() => ref.current?.click()} className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 text-sm font-medium text-subtle transition-colors hover:text-ink">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </button>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </Field>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5 shadow-e1">
      <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// The live preview — shows the owner exactly how THEIR software looks to a customer, in their brand.
function LivePreview({ b }: { b: Brand }) {
  const name = b.company_name || 'Your Company'
  const initial = name.trim().charAt(0).toUpperCase()
  const accent = b.primary_color || '#5B6CF0'
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-e2" style={{ ['--brand' as string]: accent }}>
      {/* App chrome */}
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        {b.logo_url
          ? <img src={b.logo_url} alt={name} className="h-6 w-auto max-w-[120px] object-contain" />
          : <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-semibold text-white" style={{ background: accent }}>{initial}</span>}
        <span className="text-[14px] font-semibold text-ink">{name}</span>
        <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-subtle">{initial}</span>
      </div>
      {/* Body — a mini HQ in their color */}
      <div className="space-y-3 bg-sunken/30 p-4">
        <div className="rounded-xl bg-white p-4 text-center shadow-e1">
          <div className="text-[10px] uppercase tracking-wide text-muted">Monthly recurring revenue</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: accent }}>$4,760<span className="text-sm font-normal text-muted">/mo</span></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[{ i: Building2, t: '12', s: 'Businesses' }, { i: Bot, t: '14', s: 'AI staff' }, { i: DollarSign, t: '$2k', s: 'Profit' }].map(({ i: Icon, t, s }, k) => (
            <div key={k} className="rounded-lg bg-white p-2.5 text-center shadow-e1">
              <Icon className="mx-auto h-4 w-4" style={{ color: accent }} />
              <div className="mt-1 text-sm font-semibold text-ink">{t}</div>
              <div className="text-[10px] text-muted">{s}</div>
            </div>
          ))}
        </div>
        <button className="w-full rounded-lg py-2 text-[13px] font-semibold text-white" style={{ background: accent }}>＋ New Business</button>
      </div>
      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-4 py-2.5 text-[11px] text-muted">
        {b.support_email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{b.support_email}</span>}
        {b.support_phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{b.support_phone}</span>}
        <span className="ml-auto">{b.email_footer || `© ${new Date().getFullYear()} ${name}`}</span>
      </div>
    </div>
  )
}

export function BrandStudio() {
  const [b, setB] = useState<Brand>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => { setB((s) => ({ ...s, [k]: v })); setSaved(false) }

  useEffect(() => {
    fetch('/api/partner/brand').then((r) => r.json()).then((j) => { if (j.brand) setB({ ...EMPTY, ...Object.fromEntries(Object.entries(j.brand).filter(([, v]) => v != null)) }) }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    const r = await fetch('/api/partner/brand', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    setSaving(false)
    if (!r.ok) return toast.error("Couldn't save your brand")
    setSaved(true)
    toast.success('Brand saved — your software is updated everywhere')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Brand</h1>
          <p className="mt-1 text-sm text-subtle">Design how your software looks to every customer — logo, color, and voice. It’s yours.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-white shadow-e2 transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.98] disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {saved ? 'Saved' : 'Save brand'}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Editor */}
        <div className="space-y-5 sx-animate-in">
          <Section title="Identity">
            <Field label="Company name"><input className={inp} value={b.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="e.g. Nexa AI" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <UploadField label="Logo" value={b.logo_url} onChange={(v) => set('logo_url', v)} hint="Shown in the sidebar & customer app" />
              <UploadField label="Favicon" value={b.favicon_url} onChange={(v) => set('favicon_url', v)} hint="Browser tab icon" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary color"><div className="flex items-center gap-2"><input type="color" value={b.primary_color} onChange={(e) => set('primary_color', e.target.value)} className="h-10 w-14 flex-shrink-0 cursor-pointer rounded-lg border border-hairline" /><input className={inp} value={b.primary_color} onChange={(e) => set('primary_color', e.target.value)} /></div></Field>
              <Field label="Accent color"><div className="flex items-center gap-2"><input type="color" value={b.secondary_color} onChange={(e) => set('secondary_color', e.target.value)} className="h-10 w-14 flex-shrink-0 cursor-pointer rounded-lg border border-hairline" /><input className={inp} value={b.secondary_color} onChange={(e) => set('secondary_color', e.target.value)} /></div></Field>
            </div>
          </Section>

          <Section title="Contact & voice">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Support email"><input className={inp} value={b.support_email} onChange={(e) => set('support_email', e.target.value)} placeholder="support@yourbrand.com" /></Field>
              <Field label="Support phone"><input className={inp} value={b.support_phone} onChange={(e) => set('support_phone', e.target.value)} placeholder="(555) 123-4567" /></Field>
            </div>
            <Field label="Website"><input className={inp} value={b.website} onChange={(e) => set('website', e.target.value)} placeholder="https://yourbrand.com" /></Field>
            <Field label="Email footer"><input className={inp} value={b.email_footer} onChange={(e) => set('email_footer', e.target.value)} placeholder="© Your Company. All rights reserved." /></Field>
            <label className="flex items-center gap-2.5 rounded-xl bg-sunken/50 px-3.5 py-3 text-sm text-ink">
              <input type="checkbox" checked={b.powered_by_scalix} onChange={(e) => set('powered_by_scalix', e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              Show a small “Powered by” attribution in your customer footer
            </label>
          </Section>

          <Section title="Custom domain">
            <Field label="Your domain"><input className={inp} value={b.custom_domain} onChange={(e) => set('custom_domain', e.target.value)} placeholder="app.yourbrand.com" /></Field>
            <p className="text-[13px] leading-relaxed text-subtle">Point a CNAME for this domain to your app, then save — your brand loads automatically for customers who visit it. Until then, your brand is already live inside every business you run.</p>
          </Section>
        </div>

        {/* Sticky live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-muted">Live preview</p>
          <LivePreview b={b} />
        </div>
      </div>
    </div>
  )
}
