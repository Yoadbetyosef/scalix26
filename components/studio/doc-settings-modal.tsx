'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Upload, Trash2 } from 'lucide-react'
import { LETTERHEAD_STYLES, LETTERHEAD_STYLE_META, asLetterheadStyle, type LetterheadStyle } from '@/lib/documents/letterhead-styles'

const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

// Brand colours offered as one-click swatches. null = the default neutral/ink document look.
const ACCENTS: { label: string; value: string | null }[] = [
  { label: 'Classic', value: null },
  { label: 'Blue', value: '#5B6CF0' },
  { label: 'Slate', value: '#334155' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Amber', value: '#B45309' },
  { label: 'Rose', value: '#BE123C' },
  { label: 'Violet', value: '#7C3AED' },
]

// One-time (editable) branding for every quote/invoice/production doc: logo, colour, terms, validity.
//
// The endpoints are injectable because the same branding record is reachable through two module gates —
// /api/studio/* for Studio, /api/orders/* for a tenant that only runs Orders. Defaults keep the Studio
// caller unchanged.
export function DocSettingsModal({
  onClose, onSaved,
  settingsEndpoint = '/api/studio/doc-settings',
  uploadEndpoint = '/api/studio/upload',
}: {
  onClose: () => void
  onSaved?: () => void
  settingsEndpoint?: string
  uploadEndpoint?: string
}) {
  const [logo, setLogo] = useState('')
  const [accent, setAccent] = useState<string | null>(null)
  const [terms, setTerms] = useState('')
  const [days, setDays] = useState('30')
  // The printed letterhead. Off until she turns it on, because an unbranded document is a fine
  // document and a half-filled band is not.
  const [lhOn, setLhOn] = useState(false)
  const [lhTagline, setLhTagline] = useState('')
  const [lhEmail, setLhEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  // WHICH design, and the strip of photography that prints above the footer on either of them.
  const [lhStyle, setLhStyle] = useState<LetterheadStyle>('band')
  const [strip, setStrip] = useState('')
  const [bizName, setBizName] = useState<string | null>(null)
  // The second design's OWN contact set. It is a different company — different domain, different
  // address, a toll-free number the retail side does not publish — so none of this is shared with the
  // fields above, and merging them is the one thing that must not happen here.
  const [rule, setRule] = useState<Record<string, string>>({})
  const setRuleField = (k: string, v: string) => setRule((p) => ({ ...p, [k]: v }))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(settingsEndpoint).then((r) => r.json()).then((d) => {
      const s = d.settings || {}
      setLogo(s.logo_url || ''); setAccent(s.accent_color || null)
      setTerms(s.terms || ''); setDays(String(s.validity_days || 30))
      setLhOn(s.letterhead_enabled === true); setLhTagline(s.letterhead_tagline || '')
      setLhEmail(s.letterhead_email || ''); setInstagram(s.instagram_handle || '')
      setLhStyle(asLetterheadStyle(s.letterhead_style)); setStrip(s.letterhead_strip_url || '')
      setBizName(d.businessName ?? null)
      const p = d.profiles?.rule
      if (p) {
        setRule({
          name: p.name || '', business_name: p.businessName || '', website: p.website || '',
          email: p.email || '', phone: p.phone || '', address: p.address || '',
          toll_free: p.tollFree || '', facebook: p.facebook || '', instagram: p.instagram || '',
          youtube: p.youtube || '', accent_color: p.accentColor || '',
        })
      }
    }).finally(() => setLoaded(true))
  }, [settingsEndpoint])

  async function upload(file: File) {
    setUploading(true); setErr(null)
    try {
      const body = new FormData(); body.append('file', file)
      const res = await fetch(uploadEndpoint, { method: 'POST', body })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      setLogo(d.url)
    } catch (e) { setErr((e as Error).message) } finally { setUploading(false) }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) upload(file)
  }

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(settingsEndpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo_url: logo, accent_color: accent, terms, validity_days: Number(days) || 30,
          letterhead_enabled: lhOn, letterhead_tagline: lhTagline, letterhead_email: lhEmail,
          instagram_handle: instagram,
          letterhead_style: lhStyle, letterhead_strip_url: strip,
          // Sent whenever there is anything to save, not only while that design is on screen: she may
          // correct the second company's address and then set the first one back as her default, and
          // losing the correction because of the order she clicked in would be indefensible.
          profile: Object.values(rule).some((v) => v.trim()) ? { style: 'rule', ...rule } : undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onSaved?.(); onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Document branding &amp; terms</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken"><X className="h-5 w-5" /></button>
        </div>
        {!loaded ? <p className="text-sm text-muted">Loading…</p> : (
          <div className="space-y-4">
            {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Logo</span>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${dragging ? 'border-accent bg-accent/5' : 'border-hairline-strong hover:bg-sunken/60'}`}
              >
                {logo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logo} alt="" className="h-12 w-auto max-w-[120px] flex-shrink-0 rounded border border-hairline bg-white object-contain" />
                  : <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-subtle"><Upload className="h-5 w-5" /></span>}
                <p className="min-w-0 flex-1 text-sm text-muted">
                  {uploading ? 'Uploading…' : <>Drag &amp; drop your logo here, or <span className="font-medium text-accent">browse</span><span className="mt-0.5 block text-xs text-subtle">PNG, JPG, WEBP or SVG · up to 5MB</span></>}
                </p>
                {logo && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLogo('') }}
                    title="Remove logo"
                    className="flex-shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-red-600"
                  ><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
              <input
                ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-subtle">Document colour</span>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((a) => {
                  const on = accent === a.value
                  return (
                    <button
                      key={a.label} type="button" onClick={() => setAccent(a.value)} title={a.label}
                      className={`h-8 w-8 rounded-full border transition-shadow ${on ? 'ring-2 ring-ink ring-offset-2' : 'border-hairline-strong hover:opacity-80'}`}
                      style={{ background: a.value ?? '#1F2430' }}
                    />
                  )
                })}
                <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-subtle hover:text-ink">
                  <input type="color" value={accent ?? '#5B6CF0'} onChange={(e) => setAccent(e.target.value)} className="h-8 w-8 cursor-pointer rounded-full border border-hairline-strong bg-transparent p-0" />
                  Custom
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-hairline-strong p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" checked={lhOn} onChange={(e) => setLhOn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
                <span>
                  <span className="block text-sm font-medium text-ink">Print on your letterhead</span>
                  <span className="block text-xs text-subtle">
                    A band in your document colour across the top and bottom of every page — your name, your
                    contact row, your tagline. Your website and phone come from Settings, so changing them
                    there changes them here.
                  </span>
                </span>
              </label>
              {lhOn && (
                <div className="mt-3 space-y-3 border-t border-hairline pt-3">
                  {/* THE CHOICE. Named by the business each design signs, not by the drawing, because
                      that is how she tells two pieces of stationery apart — the shape is the subtitle. */}
                  <div>
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-subtle">Default letterhead</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {LETTERHEAD_STYLES.map((k) => {
                        const on = lhStyle === k
                        // The second design is named by HER name for it, never by the tenant record:
                        // two cards both reading "TG jewellers" is not a choice.
                        const title = k === 'rule'
                          ? (rule.name?.trim() || 'Second letterhead')
                          : (bizName || LETTERHEAD_STYLE_META[k].label)
                        return (
                          <button
                            key={k} type="button" onClick={() => setLhStyle(k)}
                            className={`rounded-lg border p-2.5 text-left transition-colors ${on ? 'border-ink bg-sunken/60' : 'border-hairline-strong hover:bg-sunken/40'}`}
                          >
                            {/* A two-line sketch of the actual page, so the two are told apart by
                                looking rather than by reading. */}
                            <span className="mb-2 flex h-9 w-full flex-col justify-between overflow-hidden rounded border border-hairline bg-white">
                              <span className="block h-2.5 w-full" style={k === 'band' ? { background: accent ?? '#1F2430' } : { borderBottom: `1px solid ${rule.accent_color || '#CB0B24'}` }} />
                              <span className="block h-1.5 w-full" style={{ background: k === 'band' ? (accent ?? '#1F2430') : (rule.accent_color || '#CB0B24') }} />
                            </span>
                            <span className="block truncate text-sm font-medium text-ink">{title}</span>
                            <span className="block text-[11px] leading-snug text-subtle">{LETTERHEAD_STYLE_META[k].label}</span>
                          </button>
                        )
                      })}
                    </div>
                    <span className="mt-1 block text-xs text-subtle">
                      You can change this on any single document before you send it.
                    </span>
                  </div>

                  {lhStyle === 'band' ? (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Footer tagline</span>
                        <input className={input} value={lhTagline} onChange={(e) => setLhTagline(e.target.value)} placeholder="e.g. Custom rings &amp; fine jewellery" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Instagram</span>
                        <input className={input} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="e.g. tgjewellers" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Email shown on documents</span>
                        <input className={input} type="email" value={lhEmail} onChange={(e) => setLhEmail(e.target.value)} placeholder="e.g. sales@yourbusiness.com" />
                        <span className="mt-1 block text-xs text-subtle">Leave empty to use your account email.</span>
                      </label>
                    </>
                  ) : (
                    <div className="space-y-3">
                      {/* Its OWN details, and said out loud: this design is a second company, and a
                          field left empty here falls back to the first one's — which on a trade
                          document is the wrong domain, not a blank. */}
                      <p className="rounded-lg bg-sunken/60 px-3 py-2 text-xs leading-snug text-muted">
                        This letterhead carries its own contact details. Anything you leave empty falls back
                        to your business settings.
                      </p>
                      {[
                        ['name', 'Name (yours, to tell them apart)', 'e.g. T.G. Designs'],
                        ['business_name', 'Printed wordmark', 'e.g. T.G. DESIGNS'],
                        ['phone', 'Phone', 'e.g. +1.604.683.5633'],
                        ['email', 'Email', 'e.g. info@tg-designs.com'],
                        ['website', 'Website', 'e.g. www.tgdiamondsjewellery.com'],
                        ['address', 'Address, on one line', 'e.g. #622-736 Granville, Vancouver, BC V6Z 1G3, Canada'],
                        ['toll_free', 'Toll-free number', 'e.g. +1800 337 0041'],
                        ['facebook', 'Facebook', 'page name — the icon appears once this is set'],
                        ['instagram', 'Instagram', 'handle — the icon appears once this is set'],
                        ['youtube', 'YouTube', 'channel — the icon appears once this is set'],
                      ].map(([k, label, ph]) => (
                        <label key={k} className="block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
                          <input className={input} value={rule[k] ?? ''} onChange={(e) => setRuleField(k, e.target.value)} placeholder={ph} />
                        </label>
                      ))}
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Colour</span>
                        <span className="flex items-center gap-2">
                          <input
                            type="color" value={rule.accent_color || '#CB0B24'} onChange={(e) => setRuleField('accent_color', e.target.value)}
                            className="h-9 w-9 cursor-pointer rounded-full border border-hairline-strong bg-transparent p-0"
                          />
                          <span className="text-xs text-subtle">The rules, the wordmark and the footer band. Separate from your document colour.</span>
                        </span>
                      </label>
                    </div>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Photo strip above the footer</span>
                    <input className={input} value={strip} onChange={(e) => setStrip(e.target.value)} placeholder="/letterhead/ring-strip.jpg" />
                    <span className="mt-1 block text-xs text-subtle">
                      Prints full width at the bottom of the last page, on either letterhead. Leave empty for none.
                      Use an image at least 2550px wide so it stays sharp in print.
                    </span>
                  </label>
                </div>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Terms &amp; conditions</span>
              <textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 50% deposit to confirm. Lead time 8–10 weeks. Prices valid for 30 days." />
            </label>
            <label className="block max-w-[200px]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Quote valid for (days)</span>
              <input className={input} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={busy || uploading} className="h-11 rounded-lg bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={onClose} className="h-11 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
