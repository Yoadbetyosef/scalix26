'use client'

import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { X, Upload, Trash2 } from 'lucide-react'
import { LETTERHEAD_STYLES, LETTERHEAD_STYLE_META, asLetterheadStyle, type LetterheadStyle } from '@/lib/documents/letterhead-styles'
import { Modal } from '@/components/v2/modal'

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
    /* THE APPROVED DIALOG. This was a hand-rolled fixed overlay at z-[60] with no focus trap, no
       Escape, no scroll lock and no dialog role — and it opens from inside DocumentCreator, which is
       itself now a <Modal>, so the two used to be two different kinds of window stacked on each
       other. Not dismissable while a save or an upload is in flight. */
    <Modal
      open
      onClose={onClose}
      title="Document branding & terms"
      dismissable={!busy && !uploading}
      actions={loaded ? (
        <>
          <button onClick={save} disabled={busy || uploading} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="v2-act tap-target">Cancel</button>
        </>
      ) : undefined}
    >
      {!loaded ? <p className="v2-kick">Loading…</p> : (
        <div style={{ display: 'grid', gap: 26 }}>
          {err && (
            <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
              <span className="v2-chip-sq"><X /></span><p>{err}</p>
            </div>
          )}

          {/* The logo, on the kit's dropzone — the component that exists for exactly this. */}
          <div>
            <p className="v2-kick">Logo</p>
            <button
              type="button"
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className="v2-drop"
              data-over={dragging || undefined}
              disabled={uploading}
            >
              {logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logo} alt="" style={{ height: 44, maxWidth: 150, objectFit: 'contain' }} />
                : <Upload />}
              <b>{uploading ? 'Uploading…' : logo ? 'Replace your logo' : 'Drag your logo here, or browse'}</b>
              <span>PNG, JPG, WEBP or SVG · up to 5MB</span>
            </button>
            {logo && (
              <div className="v2-bar" style={{ marginTop: 10 }}>
                <button onClick={() => setLogo('')} className="v2-act tap-target" data-danger><Trash2 className="w-3.5 h-3.5" /> Remove logo</button>
              </div>
            )}
            <input
              ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
            />
          </div>

          <div>
            <p className="v2-kick">Document colour</p>
            <div className="v2-swatches">
              {ACCENTS.map((a) => (
                <button key={a.label} type="button" onClick={() => setAccent(a.value)} title={a.label}
                        aria-label={a.label} aria-pressed={accent === a.value}
                        data-on={accent === a.value || undefined}
                        style={{ background: a.value ?? '#1F2430' }} />
              ))}
              <label className="v2-swatch-custom">
                <input type="color" value={accent ?? '#5B6CF0'} onChange={(e) => setAccent(e.target.value)} aria-label="Custom document colour" />
                Custom
              </label>
            </div>
          </div>

          <div>
            <label className="v2-check">
              <input type="checkbox" checked={lhOn} onChange={(e) => setLhOn(e.target.checked)} />
              <span>
                Print on your letterhead
                <em>
                  A band in your document colour across the top and bottom of every page — your name, your
                  contact row, your tagline. Your website and phone come from Settings, so changing them
                  there changes them here.
                </em>
              </span>
            </label>

            {lhOn && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--v2-line)', display: 'grid', gap: 22 }}>
                {/* THE CHOICE. Named by the business each design signs, not by the drawing, because
                    that is how she tells two pieces of stationery apart — the shape is the subtitle. */}
                <div>
                  <p className="v2-kick">Default letterhead</p>
                  <div className="v2-lhpick">
                    {LETTERHEAD_STYLES.map((k) => {
                      const on = lhStyle === k
                      // The second design is named by HER name for it, never by the tenant record:
                      // two cards both reading "TG jewellers" is not a choice.
                      const title = k === 'rule'
                        ? (rule.name?.trim() || 'Second letterhead')
                        : (bizName || LETTERHEAD_STYLE_META[k].label)
                      return (
                        <button key={k} type="button" onClick={() => setLhStyle(k)} data-on={on || undefined} aria-pressed={on}>
                          {/* A two-line sketch of the actual page, so the two are told apart by
                              looking rather than by reading. */}
                          <span className="v2-lhsketch">
                            <span style={k === 'band' ? { background: accent ?? '#1F2430' } : { borderBottom: `1px solid ${rule.accent_color || '#CB0B24'}` }} />
                            <span style={{ background: k === 'band' ? (accent ?? '#1F2430') : (rule.accent_color || '#CB0B24'), height: 6 }} />
                          </span>
                          <b>{title}</b>
                          <em>{LETTERHEAD_STYLE_META[k].label}</em>
                        </button>
                      )
                    })}
                  </div>
                  <p className="v2-hint" style={{ marginTop: 10 }}>You can change this on any single document before you send it.</p>
                </div>

                {lhStyle === 'band' ? (
                  <div className="v2-form">
                    <Fld id="lh-tag" label="Footer tagline" wide><input value={lhTagline} onChange={(e) => setLhTagline(e.target.value)} placeholder="e.g. Custom rings & fine jewellery" /></Fld>
                    <Fld id="lh-ig" label="Instagram"><input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="e.g. tgjewellers" /></Fld>
                    <Fld id="lh-email" label="Email shown on documents" hint="Leave empty to use your account email."><input type="email" value={lhEmail} onChange={(e) => setLhEmail(e.target.value)} placeholder="e.g. sales@yourbusiness.com" /></Fld>
                  </div>
                ) : (
                  <div>
                    {/* Its OWN details, and said out loud: this design is a second company, and a
                        field left empty here falls back to the first one's — which on a trade
                        document is the wrong domain, not a blank. */}
                    <p className="v2-hint" style={{ marginBottom: 18 }}>
                      This letterhead carries its own contact details. Anything you leave empty falls back
                      to your business settings.
                    </p>
                    <div className="v2-form">
                      {([
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
                      ] as [string, string, string][]).map(([k, label, ph]) => (
                        <Fld key={k} id={`lhr-${k}`} label={label} wide={k === 'address' || k === 'name'}>
                          <input value={rule[k] ?? ''} onChange={(e) => setRuleField(k, e.target.value)} placeholder={ph} />
                        </Fld>
                      ))}
                      <div className="v2-fld wide">
                        <label htmlFor="lhr-accent">Colour</label>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                          <input id="lhr-accent" type="color" value={rule.accent_color || '#CB0B24'}
                                 onChange={(e) => setRuleField('accent_color', e.target.value)} className="v2-color" />
                          <span className="v2-hint">The rules, the wordmark and the footer band. Separate from your document colour.</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <Fld id="lh-strip" label="Photo strip above the footer"
                     hint="Prints full width at the bottom of the last page, on either letterhead. Leave empty for none. Use an image at least 2550px wide so it stays sharp in print.">
                  <input value={strip} onChange={(e) => setStrip(e.target.value)} placeholder="/letterhead/ring-strip.jpg" />
                </Fld>
              </div>
            )}
          </div>

          <div className="v2-form">
            <Fld id="doc-terms" label="Terms & conditions" wide>
              <textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 50% deposit to confirm. Lead time 8–10 weeks. Prices valid for 30 days." />
            </Fld>
            <Fld id="doc-days" label="Quote valid for (days)">
              <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </Fld>
          </div>
        </div>
      )}
    </Modal>
  )
}

// One field, with the label and the control as siblings. Written with an explicit id rather than a
// derived one because two of the labels below repeat between the band form and the rule form.
function Fld({ id, label, hint, children, wide }: { id: string; label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const child = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children
  return (
    <div className={wide ? 'v2-fld wide' : 'v2-fld'}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && <span className="v2-hint">{hint}</span>}
    </div>
  )
}
