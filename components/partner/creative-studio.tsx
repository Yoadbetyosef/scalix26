'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Panel, EmptyRow } from '@/components/partner/ui'
import { input, label, textarea, PLATFORMS, STATUS_STYLE, fmtDate, EducationalEmpty, Modal, parseVideo } from '@/components/partner/marketing-ui'
import {
  Plus, Copy, Eye, Pencil, Palette, Info, Image as ImageIcon, Video, Mail, MessageSquare, FileText, Megaphone,
  Sparkles, Play, Archive, Upload, Loader2, Check, Wand2, RotateCcw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Creative { id: string; type: string; title: string; body: string | null; asset_url: string | null; status: string; campaign_id: string | null; tags: string[]; created_at: string }

const CREATIVE_TYPES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'ad_copy', label: 'Ad Copy', icon: Megaphone }, { key: 'image', label: 'Image', icon: ImageIcon }, { key: 'video', label: 'Video', icon: Video },
  { key: 'email', label: 'Email', icon: Mail }, { key: 'sms', label: 'SMS', icon: MessageSquare }, { key: 'call_script', label: 'Script', icon: FileText },
]
const typeMeta = (t: string) => CREATIVE_TYPES.find((x) => x.key === t) || { key: t, label: t.replace(/_/g, ' '), icon: FileText }

// AI actions (keys mirror lib/partner/marketing-ai.ts), grouped for the ✨ menu.
const AI_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  { group: 'Improve', items: [
    { key: 'improve_copy', label: 'Improve copy' }, { key: 'shorten', label: 'Shorten' }, { key: 'expand', label: 'Expand' },
    { key: 'improve_headline', label: 'Improve headline (10)' }, { key: 'improve_cta', label: 'Improve CTA' },
  ] },
  { group: 'Variations', items: [{ key: 'variations', label: 'Generate 5 variations' }] },
  { group: 'Repurpose', items: [
    { key: 'facebook', label: 'Facebook version' }, { key: 'instagram', label: 'Instagram version' }, { key: 'google_search', label: 'Google Search version' },
    { key: 'display', label: 'Display ad version' }, { key: 'email', label: 'Email version' }, { key: 'sms', label: 'SMS version' },
    { key: 'cold_dm', label: 'Cold DM' }, { key: 'video_script', label: 'Video script' }, { key: 'voice_script', label: 'Voice script' },
  ] },
  { group: 'Analyze', items: [{ key: 'analyze', label: 'Analyze conversion potential' }] },
]

function creativeData(c: { body: string | null }): Record<string, string> {
  if (!c.body) return {}
  try { const o = JSON.parse(c.body); return o && typeof o === 'object' && !Array.isArray(o) ? o : { text: String(c.body) } }
  catch { return { text: c.body } }
}
function creativePreview(c: Creative): string {
  const d = creativeData(c)
  if (d.text) return d.text
  switch (c.type) {
    case 'ad_copy': return [d.headline && `HEADLINE\n${d.headline}`, d.primary && `PRIMARY TEXT\n${d.primary}`, d.cta && `CTA: ${d.cta}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'image': return [d.notes && `Notes:\n${d.notes}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'video': return [d.script && `SCRIPT\n${d.script}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'email': return d.body || ''
    case 'sms': return d.body || ''
    case 'call_script': return [d.script, d.useCase && `\nUse case: ${d.useCase}`].filter(Boolean).join('\n')
    default: return d.body || d.text || ''
  }
}

function Thumb({ c }: { c: Creative }) {
  const meta = typeMeta(c.type)
  if (c.type === 'image' && c.asset_url) return <img src={c.asset_url} alt={c.title} className="h-full w-full object-cover" />
  if (c.type === 'video') {
    const v = parseVideo(c.asset_url || '')
    return (
      <div className="relative h-full w-full">
        {v.thumb ? <img src={v.thumb} alt={c.title} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-ink/90"><Video className="h-6 w-6 text-white/70" /></div>}
        <div className="absolute inset-0 flex items-center justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur"><Play className="h-4 w-4 fill-white text-white" /></span></div>
      </div>
    )
  }
  return <div className="flex h-full w-full items-center justify-center bg-sunken"><meta.icon className="h-6 w-6 text-muted" /></div>
}

export function CreativeStudio({ focusCampaign }: { focusCampaign?: string }) {
  const [mine, setMine] = useState<Creative[]>([])
  const [official, setOfficial] = useState<Creative[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; creative?: Creative } | null>(null)
  const [preview, setPreview] = useState<Creative | null>(null)
  const [ai, setAi] = useState<Creative | null>(null)

  const load = useCallback(async () => {
    const [j, c] = await Promise.all([fetch('/api/partner/creatives').then((r) => r.json()), fetch('/api/partner/campaigns').then((r) => r.json())])
    setMine(j.mine || []); setOfficial(j.official || []); setCampaigns((c.campaigns || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))
  }, [])
  useEffect(() => { load() }, [load])
  const cName = (id: string | null) => id ? campaigns.find((c) => c.id === id)?.name : null

  async function setStatus(id: string, status: string) { await fetch('/api/partner/creatives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  async function clone(id: string) { const r = await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cloneFrom: id }) }); if (!r.ok) return toast.error('Failed'); toast.success('Duplicated'); load() }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-subtle">Your media library — images, video, ad copy, scripts. Connect each to a campaign, then let AI improve and repurpose it.</p>
        <button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white sm:px-4"><Plus className="h-4 w-4" /><span className="hidden sm:inline">New creative</span></button>
      </div>

      {mine.length === 0 ? (
        <EducationalEmpty icon={Palette} title="Build your creative library" body="Upload images, embed video (YouTube, Loom, Vimeo), and write ad copy, scripts, emails and texts. Connect each to a campaign, mark winners, and use AI to improve and repurpose every asset." cta={<button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create a creative</button>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mine.map((c) => {
            const meta = typeMeta(c.type)
            return (
              <div key={c.id} className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-e1">
                <button onClick={() => setPreview(c)} className="relative aspect-video w-full overflow-hidden bg-sunken">
                  <Thumb c={c} />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur"><meta.icon className="h-3 w-3" />{meta.label}</span>
                  <span className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[c.status] || STATUS_STYLE.draft}`}>{c.status}</span>
                </button>
                <div className="flex flex-1 flex-col p-2.5">
                  <div className="truncate text-sm font-medium text-ink">{c.title}</div>
                  {c.campaign_id ? (
                    <div className="mt-0.5 truncate text-[11px] text-muted">{cName(c.campaign_id) || 'Campaign'}</div>
                  ) : (
                    <button onClick={() => setEditor({ mode: 'edit', creative: c })} className="mt-0.5 inline-flex items-center gap-1 truncate text-[11px] font-medium text-amber-600 hover:underline"><Info className="h-3 w-3 shrink-0" /> Connect to campaign</button>
                  )}
                  <div className="mt-1 text-[10px] text-muted">{fmtDate(c.created_at)}</div>
                  <div className="mt-2 flex items-center gap-1">
                    <button onClick={() => setAi(c)} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-accent/10 text-xs font-medium text-accent-strong hover:bg-accent/15"><Sparkles className="h-3.5 w-3.5" /> AI</button>
                    <button onClick={() => setEditor({ mode: 'edit', creative: c })} title="Edit" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => clone(c.id)} title="Duplicate" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /></button>
                    {c.status !== 'archived'
                      ? <button onClick={() => setStatus(c.id, 'archived')} title="Archive" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Archive className="h-3.5 w-3.5" /></button>
                      : <button onClick={() => setStatus(c.id, 'draft')} title="Restore" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Panel title="Official Scalix library">
        {official.length === 0 ? <EmptyRow>Curated official creatives will appear here to clone into your library.</EmptyRow> : (
          <div className="divide-y divide-hairline">{official.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle">{typeMeta(c.type).label}</span>
              <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
              <button onClick={() => setPreview(c)} className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink" title="Preview"><Eye className="h-3.5 w-3.5" /></button>
              <button onClick={() => clone(c.id)} className="inline-flex items-center gap-1 rounded-md border border-hairline-strong px-2 py-1 text-xs text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /> Clone</button>
            </div>
          ))}</div>
        )}
      </Panel>

      {editor && <CreativeEditor mode={editor.mode} creative={editor.creative} campaigns={campaigns} defaultCampaign={focusCampaign} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />}
      {preview && <CreativePreview c={preview} campaignName={cName(preview.campaign_id)} onClose={() => setPreview(null)} onAi={() => { setAi(preview); setPreview(null) }} />}
      {ai && <AiActions c={ai} onClose={() => setAi(null)} onSaved={() => { setAi(null); load() }} />}
    </div>
  )
}

function CreativePreview({ c, campaignName, onClose, onAi }: { c: Creative; campaignName?: string | null; onClose: () => void; onAi: () => void }) {
  const v = c.type === 'video' ? parseVideo(c.asset_url || '') : null
  return (
    <Modal title={c.title} onClose={onClose} wide={c.type === 'video' || c.type === 'image'}>
      <div className="mb-3 text-xs text-muted">{typeMeta(c.type).label}{c.campaign_id && ` · ${campaignName || 'Campaign'}`}</div>
      {c.type === 'image' && c.asset_url && <img src={c.asset_url} alt={c.title} className="mb-3 max-h-[60vh] w-full rounded-lg border border-hairline object-contain" />}
      {c.type === 'video' && (
        v?.embedUrl && v.provider !== 'file' ? <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg border border-hairline"><iframe src={v.embedUrl} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></div>
        : v?.provider === 'file' ? <video src={v.embedUrl!} controls className="mb-3 max-h-[60vh] w-full rounded-lg border border-hairline" />
        : <div className="mb-3 rounded-lg border border-dashed border-hairline-strong p-6 text-center text-sm text-muted">No playable video URL attached.</div>
      )}
      {creativePreview(c) && <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{creativePreview(c)}</pre>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => { navigator.clipboard.writeText(creativePreview(c)); toast.success('Copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Copy className="h-4 w-4" /> Copy</button>
        <button onClick={onAi} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/10 text-sm font-medium text-accent-strong hover:bg-accent/15"><Sparkles className="h-4 w-4" /> AI actions</button>
      </div>
    </Modal>
  )
}

function AiActions({ c, onClose, onSaved }: { c: Creative; onClose: () => void; onSaved: () => void }) {
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ action: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const data = creativeData(c)
  const platform = data.platform

  async function run(action: string, actionLabel: string) {
    setRunning(action); setResult(null)
    const r = await fetch('/api/partner/marketing/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'creative', action, payload: { type: c.type, title: c.title, text: creativePreview(c), platform } }) })
    const j = await r.json().catch(() => ({}))
    setRunning(null)
    if (!r.ok || !j.result) return toast.error(j.error || 'AI request failed')
    setResult({ action: actionLabel, text: j.result })
  }
  async function saveAsNew() {
    if (!result) return
    setSaving(true)
    const r = await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: c.type, title: `${c.title} — ${result.action}`, campaign_id: c.campaign_id, body: JSON.stringify({ text: result.text }) }) })
    setSaving(false)
    if (!r.ok) return toast.error('Could not save')
    toast.success('Saved as new creative'); onSaved()
  }

  return (
    <Modal title="✨ AI actions" onClose={onClose} wide>
      <div className="mb-3 text-xs text-muted">On: <span className="text-subtle">{c.title}</span></div>
      {!result ? (
        <div className="space-y-3">
          {AI_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <button key={it.key} disabled={!!running} onClick={() => run(it.key, it.label)} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs font-medium text-subtle hover:border-accent/40 hover:text-ink disabled:opacity-50">
                    {running === it.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-accent-strong" />}{it.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><Check className="h-4 w-4 text-green-600" /> {result.action}</div>
          <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-canvas p-3 font-sans text-sm leading-relaxed text-ink">{result.text}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => { navigator.clipboard.writeText(result.text); toast.success('Copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Copy className="h-4 w-4" /> Copy</button>
            <button onClick={saveAsNew} disabled={saving} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save as new</button>
            <button onClick={() => setResult(null)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink">More</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function CreativeEditor({ mode, creative, campaigns, defaultCampaign, onClose, onSaved }: { mode: 'create' | 'edit'; creative?: Creative; campaigns: { id: string; name: string }[]; defaultCampaign?: string; onClose: () => void; onSaved: () => void }) {
  const init = creative ? creativeData(creative) : {}
  const [type, setType] = useState(creative?.type || 'ad_copy')
  const [title, setTitle] = useState(creative?.title || '')
  const [campaignId, setCampaignId] = useState(creative?.campaign_id || defaultCampaign || '')
  const [assetUrl, setAssetUrl] = useState(creative?.asset_url || '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [headline, setHeadline] = useState(init.headline || '')
  const [primary, setPrimary] = useState(init.primary || '')
  const [cta, setCta] = useState(init.cta || '')
  const [platform, setPlatform] = useState(init.platform || 'meta')
  const [notes, setNotes] = useState(init.notes || '')
  const [script, setScript] = useState(init.script || '')
  const [body, setBody] = useState(init.body || init.text || '')
  const [useCase, setUseCase] = useState(init.useCase || '')

  async function upload(file: File) {
    setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/partner/marketing/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    setUploading(false)
    if (!r.ok || !j.url) return toast.error(j.error || 'Upload failed')
    setAssetUrl(j.url); toast.success('Uploaded')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return toast.error(type === 'email' ? 'Subject is required' : 'Title is required')
    let data: Record<string, string> = {}
    let asset: string | null = null
    if (type === 'ad_copy') { if (!headline.trim() && !primary.trim()) return toast.error('Add a headline or primary text'); data = { headline, primary, cta, platform } }
    else if (type === 'image') { if (!assetUrl.trim()) return toast.error('Upload or link an image'); asset = assetUrl.trim(); data = { notes, platform } }
    else if (type === 'video') { if (!assetUrl.trim() && !script.trim()) return toast.error('Add a video link or a script'); asset = assetUrl.trim() || null; data = { script, platform } }
    else if (type === 'email') { if (!body.trim()) return toast.error('Add the email body'); data = { body } }
    else if (type === 'sms') { if (!body.trim()) return toast.error('Add the message'); data = { body } }
    else if (type === 'call_script') { if (!script.trim()) return toast.error('Add the script'); data = { script, useCase } }

    const payload = { type, title: title.trim(), campaign_id: campaignId || null, asset_url: asset, body: JSON.stringify(data) }
    const r = mode === 'create'
      ? await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/partner/creatives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: creative!.id, ...payload }) })
    if (!r.ok) return toast.error('Could not save creative')
    toast.success(mode === 'create' ? 'Creative added' : 'Creative updated'); onSaved()
  }

  const v = type === 'video' ? parseVideo(assetUrl) : null
  const campaignSelect = (
    <div><label className={label}>Campaign {!campaignId && <span className="text-amber-600">· connect for attribution</span>}</label>
      <select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
        <option value="">Not connected</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></div>
  )
  const platformSelect = <div><label className={label}>Platform</label><select className={`${input} capitalize`} value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select></div>

  return (
    <Modal title={mode === 'create' ? 'New creative' : 'Edit creative'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <div><label className={label}>Type</label>
          <div className="flex flex-wrap gap-1.5">
            {CREATIVE_TYPES.map((t) => (
              <button type="button" key={t.key} onClick={() => setType(t.key)} disabled={mode === 'edit'} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${type === t.key ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'} ${mode === 'edit' ? 'opacity-60' : ''}`}><t.icon className="h-3 w-3" />{t.label}</button>
            ))}
          </div>
        </div>

        <div><label className={label}>{type === 'email' ? 'Subject' : type === 'sms' ? 'Label' : 'Title'}</label>
          <input className={input} placeholder={type === 'email' ? 'Email subject line' : type === 'sms' ? 'e.g. Post-demo nudge' : 'Internal name for this creative'} value={title} onChange={(e) => setTitle(e.target.value)} /></div>

        {type === 'image' && <>
          <div>
            <label className={label}>Image</label>
            {assetUrl ? (
              <div className="relative overflow-hidden rounded-lg border border-hairline">
                <img src={assetUrl} alt="preview" className="max-h-52 w-full object-contain bg-sunken" />
                <button type="button" onClick={() => setAssetUrl('')} className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">Replace</button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-hairline-strong text-sm text-subtle hover:border-accent/40">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}{uploading ? 'Uploading…' : 'Upload image (JPG/PNG/WEBP, ≤10MB)'}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
            <input className={`${input} mt-2`} placeholder="…or paste an image URL" value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} />
          </div>
          <div><label className={label}>Notes</label><textarea className={textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where/how to use this image…" /></div>
          {platformSelect}{campaignSelect}
        </>}

        {type === 'video' && <>
          <div><label className={label}>Video link</label>
            <input className={input} value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="YouTube, Loom, Vimeo, or an .mp4 URL" />
            {assetUrl && (v?.embedUrl
              ? <div className="mt-2 flex items-center gap-2 text-[11px] text-green-700"><Check className="h-3.5 w-3.5" /> Detected {v.provider} — will play inside a preview.</div>
              : <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-600"><Info className="h-3.5 w-3.5" /> Paste a YouTube, Loom, Vimeo or .mp4 link.</div>)}
            {v?.thumb && <img src={v.thumb} alt="thumb" className="mt-2 aspect-video w-40 rounded-md border border-hairline object-cover" />}
          </div>
          <div><label className={label}>Script (optional)</label><textarea className={textarea} rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder="The spoken/on-screen script…" /></div>
          {platformSelect}{campaignSelect}
        </>}

        {type === 'ad_copy' && <>
          <div><label className={label}>Headline</label><input className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Your AI employee, working 24/7" /></div>
          <div><label className={label}>Primary text</label><textarea className={textarea} rows={3} value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="The body of the ad…" /></div>
          <div><label className={label}>CTA</label><input className={input} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Get a free demo" /></div>
          {platformSelect}{campaignSelect}
        </>}
        {type === 'email' && <><div><label className={label}>Body</label><textarea className={textarea} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Email body…" /></div>{campaignSelect}</>}
        {type === 'sms' && <><div><label className={label}>Message</label><textarea className={textarea} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Text message…" /></div>{campaignSelect}</>}
        {type === 'call_script' && <>
          <div><label className={label}>Script</label><textarea className={textarea} rows={6} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Call / sales script…" /></div>
          <div><label className={label}>Use case</label><input className={input} value={useCase} onChange={(e) => setUseCase(e.target.value)} placeholder="e.g. Cold call opener" /></div>
          {campaignSelect}
        </>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
          <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">{mode === 'create' ? 'Add creative' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  )
}
