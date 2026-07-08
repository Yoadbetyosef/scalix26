'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { input, label, textarea, STATUS_STYLE, EducationalEmpty, Modal, Metric } from '@/components/partner/marketing-ui'
import { LandingRender, type LandingConfig } from '@/components/partner/landing-render'
import {
  Plus, LayoutTemplate, Link2, Eye, ExternalLink, Copy, Archive, RotateCcw, Pencil, Sparkles, Monitor, Tablet,
  Smartphone, Loader2, Upload, X, Check, Wand2,
} from 'lucide-react'

interface LP {
  id: string; slug: string; headline: string; subhead: string | null; cta_text: string; views: number; clicks: number; link_code: string | null
  campaign_id: string | null; campaign_name: string | null; creative_id: string | null; creative_title: string | null; status: string
  config: { accent?: string; features?: string[]; socialProof?: string; logoUrl?: string; imageUrl?: string; videoUrl?: string }; created_at: string
}
const AI_ACTIONS = [
  { key: 'improve_headline', label: 'Improve headline' }, { key: 'improve_hero', label: 'Improve hero' }, { key: 'improve_cta', label: 'Improve CTA' },
  { key: 'improve_seo', label: 'Improve SEO' }, { key: 'local_seo', label: 'Local SEO' }, { key: 'faq', label: 'Generate FAQ' },
  { key: 'social_proof', label: 'Add social proof' }, { key: 'trust', label: 'Trust signals' }, { key: 'mobile', label: 'Mobile conversion' },
  { key: 'analyze', label: 'Analyze conversion' },
]

export function LandingBuilder({ focusCampaign }: { focusCampaign?: string }) {
  const [list, setList] = useState<LP[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [creatives, setCreatives] = useState<{ id: string; title: string }[]>([])
  const [origin, setOrigin] = useState('')
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; page?: LP } | null>(null)
  const [preview, setPreview] = useState<LP | null>(null)
  const [ai, setAi] = useState<LP | null>(null)

  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => {
    const [j, c, cr] = await Promise.all([
      fetch('/api/partner/landing-pages').then((r) => r.json()),
      fetch('/api/partner/campaigns').then((r) => r.json()),
      fetch('/api/partner/creatives').then((r) => r.json()),
    ])
    setList(j.pages || [])
    setCampaigns((c.campaigns || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))
    setCreatives((cr.mine || []).map((x: { id: string; title: string }) => ({ id: x.id, title: x.title })))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (focusCampaign) setEditor({ mode: 'create' }) }, [focusCampaign])

  async function setStatus(id: string, status: string) { await fetch('/api/partner/landing-pages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  async function duplicate(p: LP) {
    const r = await fetch('/api/partner/landing-pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headline: `${p.headline} (copy)`, subhead: p.subhead, cta_text: p.cta_text, campaign_id: p.campaign_id, creative_id: p.creative_id, config: p.config, status: 'draft' }) })
    if (!r.ok) return toast.error('Could not duplicate'); toast.success('Duplicated as draft'); load()
  }
  const url = (p: LP) => `${origin}/l/${p.slug}`

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-subtle">Build Scalix-hosted pages with a live preview — no external tools. Every view, click and signup attributes to you.</p>
        {list.length > 0 && <button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white sm:px-4"><Plus className="h-4 w-4" /><span className="hidden sm:inline">New page</span></button>}
      </div>

      {list.length === 0 ? (
        <EducationalEmpty icon={LayoutTemplate} title="Build a page that converts" body="Compose a branded landing page — hero, features, social proof, image or video — with a live desktop/tablet/mobile preview. Publish, share the link, and every view and signup attributes back to you automatically." cta={<button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Build your first page</button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((p) => {
            const ctr = p.views > 0 ? Math.round((p.clicks / p.views) * 100) : null
            return (
              <div key={p.id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.headline}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">/l/{p.slug}{p.campaign_name && ` · ${p.campaign_name}`}{p.creative_title && ` · ${p.creative_title}`}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[p.status] || STATUS_STYLE.published}`}>{p.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
                  <Metric label="Views" value={String(p.views)} note="auto" />
                  <Metric label="Clicks" value={String(p.clicks)} note="auto" />
                  <Metric label="CTR" value={ctr != null ? `${ctr}%` : '—'} note="auto" />
                </div>
                <p className="mt-2 text-[11px] text-muted">Demos, trials & paid customers roll up to its campaign in Performance.</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
                  <button onClick={() => setPreview(p)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Eye className="h-3.5 w-3.5" /> Preview</button>
                  <button onClick={() => setAi(p)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent/10 px-2.5 text-xs font-medium text-accent-strong hover:bg-accent/15"><Sparkles className="h-3.5 w-3.5" /> AI</button>
                  <button onClick={() => { navigator.clipboard.writeText(url(p)); toast.success('Link copied') }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Link2 className="h-3.5 w-3.5" /> Copy</button>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => setEditor({ mode: 'edit', page: p })} title="Edit" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => duplicate(p)} title="Duplicate" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /></button>
                    <a href={url(p)} target="_blank" rel="noreferrer" title="Open live" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /></a>
                    {p.status !== 'archived'
                      ? <button onClick={() => setStatus(p.id, 'archived')} title="Archive" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Archive className="h-3.5 w-3.5" /></button>
                      : <button onClick={() => setStatus(p.id, 'published')} title="Republish" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editor && <LandingEditor mode={editor.mode} page={editor.page} campaigns={campaigns} creatives={creatives} defaultCampaign={focusCampaign} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />}
      {preview && <LivePreview p={preview} ctaHref={preview.link_code ? `/r/${preview.link_code}` : '#'} onClose={() => setPreview(null)} />}
      {ai && <LandingAi p={ai} onClose={() => setAi(null)} />}
    </div>
  )
}

function LivePreview({ p, ctaHref, onClose }: { p: LP; ctaHref: string; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const cfg: LandingConfig = { headline: p.headline, subhead: p.subhead, ctaText: p.cta_text, ctaHref, accent: p.config?.accent, logoUrl: p.config?.logoUrl, imageUrl: p.config?.imageUrl, videoUrl: p.config?.videoUrl, features: p.config?.features, socialProof: p.config?.socialProof }
  const w = device === 'desktop' ? 'w-full' : device === 'tablet' ? 'w-[768px]' : 'w-[390px]'
  return (
    <Modal title="Live preview" onClose={onClose} wide>
      <div className="mb-3 flex justify-center gap-1.5">
        {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
          <button key={d} onClick={() => setDevice(d)} className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${device === d ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'}`}><Icon className="h-3.5 w-3.5" />{d}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline bg-canvas p-2">
        <div className={`mx-auto ${w} max-h-[62vh] overflow-y-auto rounded-lg`}><LandingRender c={cfg} /></div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted">This is exactly what visitors see at {p.link_code ? `/l/${p.slug}` : 'your public URL'}.</p>
    </Modal>
  )
}

function LandingAi({ p, onClose }: { p: LP; onClose: () => void }) {
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ action: string; text: string } | null>(null)
  async function run(action: string, actionLabel: string) {
    setRunning(action); setResult(null)
    const extra = [p.config?.features?.length ? `Features: ${p.config.features.join('; ')}` : '', p.config?.socialProof ? `Social proof: ${p.config.socialProof}` : ''].filter(Boolean).join('\n')
    const r = await fetch('/api/partner/marketing/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'landing', action, payload: { headline: p.headline, subhead: p.subhead, cta_text: p.cta_text, extra } }) })
    const j = await r.json().catch(() => ({}))
    setRunning(null)
    if (!r.ok || !j.result) return toast.error(j.error || 'AI request failed')
    setResult({ action: actionLabel, text: j.result })
  }
  return (
    <Modal title="✨ Optimize landing page" onClose={onClose} wide>
      <div className="mb-3 text-xs text-muted">On: <span className="text-subtle">{p.headline}</span></div>
      {!result ? (
        <div className="flex flex-wrap gap-1.5">
          {AI_ACTIONS.map((a) => (
            <button key={a.key} disabled={!!running} onClick={() => run(a.key, a.label)} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs font-medium text-subtle hover:border-accent/40 hover:text-ink disabled:opacity-50">
              {running === a.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-accent-strong" />}{a.label}
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><Check className="h-4 w-4 text-green-600" /> {result.action}</div>
          <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-canvas p-3 font-sans text-sm leading-relaxed text-ink">{result.text}</pre>
          <div className="mt-3 flex gap-2">
            <button onClick={() => { navigator.clipboard.writeText(result.text); toast.success('Copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Copy className="h-4 w-4" /> Copy</button>
            <button onClick={() => setResult(null)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink">More</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function LandingEditor({ mode, page, campaigns, creatives, defaultCampaign, onClose, onSaved }: { mode: 'create' | 'edit'; page?: LP; campaigns: { id: string; name: string }[]; creatives: { id: string; title: string }[]; defaultCampaign?: string; onClose: () => void; onSaved: () => void }) {
  const cfg = page?.config || {}
  const [headline, setHeadline] = useState(page?.headline || '')
  const [subhead, setSubhead] = useState(page?.subhead || '')
  const [cta, setCta] = useState(page?.cta_text || 'Start free — set up your AI employee')
  const [campaignId, setCampaignId] = useState(page?.campaign_id || defaultCampaign || '')
  const [creativeId, setCreativeId] = useState(page?.creative_id || '')
  const [features, setFeatures] = useState<string[]>(cfg.features?.length ? cfg.features : ['', ''])
  const [socialProof, setSocialProof] = useState(cfg.socialProof || '')
  const [logoUrl, setLogoUrl] = useState(cfg.logoUrl || '')
  const [imageUrl, setImageUrl] = useState(cfg.imageUrl || '')
  const [videoUrl, setVideoUrl] = useState(cfg.videoUrl || '')
  const [accent, setAccent] = useState(cfg.accent || '#5B6CF0')
  const [uploading, setUploading] = useState<'logo' | 'image' | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)

  async function upload(file: File, which: 'logo' | 'image') {
    setUploading(which)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/partner/marketing/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({})); setUploading(null)
    if (!r.ok || !j.url) return toast.error(j.error || 'Upload failed')
    if (which === 'logo') setLogoUrl(j.url); else setImageUrl(j.url)
  }

  const preview: LandingConfig = { headline: headline || 'Your headline', subhead, ctaText: cta, ctaHref: '#', accent, logoUrl, imageUrl, videoUrl, features: features.filter(Boolean), socialProof }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!headline.trim()) return toast.error('Add a hero headline')
    const config = { accent, features: features.map((f) => f.trim()).filter(Boolean), socialProof: socialProof.trim() || null, logoUrl: logoUrl || null, imageUrl: imageUrl || null, videoUrl: videoUrl || null }
    const bodyBase = { headline: headline.trim(), subhead: subhead.trim() || null, cta_text: cta.trim() || 'Start free', campaign_id: campaignId || null, creative_id: creativeId || null, config }
    const r = mode === 'create'
      ? await fetch('/api/partner/landing-pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyBase, status: 'published' }) })
      : await fetch('/api/partner/landing-pages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: page!.id, ...bodyBase }) })
    if (!r.ok) return toast.error('Could not save page')
    toast.success(mode === 'create' ? 'Landing page published' : 'Landing page updated'); onSaved()
  }

  const uploadBtn = (which: 'logo' | 'image', val: string, setVal: (s: string) => void, ref: React.RefObject<HTMLInputElement | null>) => (
    <div>
      {val ? (
        <div className="relative inline-block"><img src={val} alt={which} className={`rounded-lg border border-hairline object-contain ${which === 'logo' ? 'h-12' : 'h-24 w-full object-cover'}`} /><button type="button" onClick={() => setVal('')} className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-white"><X className="h-3 w-3" /></button></div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={uploading === which} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-hairline-strong px-3 text-xs font-medium text-subtle hover:border-accent/40">{uploading === which ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Upload {which}</button>
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, which) }} />
    </div>
  )

  return (
    <Modal title={mode === 'create' ? 'Build landing page' : 'Edit landing page'} onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-2">
        <form className="space-y-3" onSubmit={submit}>
          <div><label className={label}>Hero title</label><input className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="An AI employee for your business" /></div>
          <div><label className={label}>Hero subtitle</label><textarea className={textarea} rows={2} value={subhead} onChange={(e) => setSubhead(e.target.value)} placeholder="Leave blank to use strong default copy" /></div>
          <div><label className={label}>CTA button</label><input className={input} value={cta} onChange={(e) => setCta(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Campaign</label><select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className={label}>Creative</label><select className={input} value={creativeId} onChange={(e) => setCreativeId(e.target.value)}><option value="">None</option>{creatives.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
          </div>
          <div>
            <label className={label}>Feature bullets</label>
            <div className="space-y-1.5">
              {features.map((f, i) => (
                <div key={i} className="flex gap-1.5">
                  <input className={input} value={f} onChange={(e) => setFeatures((xs) => xs.map((x, j) => j === i ? e.target.value : x))} placeholder={`Feature ${i + 1}`} />
                  <button type="button" onClick={() => setFeatures((xs) => xs.filter((_, j) => j !== i))} className="shrink-0 rounded-md border border-hairline-strong px-2 text-subtle hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setFeatures((xs) => [...xs, ''])} className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong"><Plus className="h-3.5 w-3.5" /> Add feature</button>
            </div>
          </div>
          <div><label className={label}>Social proof</label><input className={input} value={socialProof} onChange={(e) => setSocialProof(e.target.value)} placeholder="e.g. Booked 6 extra jobs in week one" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Logo</label>{uploadBtn('logo', logoUrl, setLogoUrl, logoRef)}</div>
            <div><label className={label}>Accent</label><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-full rounded-lg border border-hairline-strong" /></div>
          </div>
          <div><label className={label}>Hero image (optional)</label>{uploadBtn('image', imageUrl, setImageUrl, imgRef)}</div>
          <div><label className={label}>Video (optional)</label><input className={input} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="YouTube / Loom / Vimeo link" /></div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
            <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">{mode === 'create' ? 'Publish' : 'Save changes'}</button>
          </div>
        </form>
        <div className="hidden lg:block">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Live preview</div>
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-hairline bg-canvas"><LandingRender c={preview} /></div>
        </div>
      </div>
    </Modal>
  )
}
