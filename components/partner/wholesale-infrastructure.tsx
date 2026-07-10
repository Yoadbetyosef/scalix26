'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Phone, Brain, AudioLines, Mail, Share2, Globe, CheckCircle2, AlertTriangle, X, Loader2, Plug, RefreshCw, type LucideIcon } from 'lucide-react'

interface Integration { provider: string; status: 'not_connected' | 'connected' | 'needs_attention'; meta: Record<string, unknown>; health: number | null; last_verified_at: string | null; configurable: boolean }
interface Field { k: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }
interface ProviderDef { key: string; name: string; desc: string; icon: LucideIcon; fields?: Field[]; oauth?: boolean }

const PROVIDERS: ProviderDef[] = [
  { key: 'twilio', name: 'Twilio', desc: 'Phone numbers, SMS & voice', icon: Phone, fields: [
    { k: 'account_sid', label: 'Account SID', placeholder: 'AC…' }, { k: 'auth_token', label: 'Auth Token', secret: true },
    { k: 'messaging_service_sid', label: 'Messaging Service SID', optional: true }, { k: 'phone_number', label: 'Default number', optional: true },
  ] },
  { key: 'openai', name: 'OpenAI', desc: 'AI language models', icon: Brain, fields: [{ k: 'api_key', label: 'API Key', secret: true, placeholder: 'sk-…' }, { k: 'model', label: 'Default model', optional: true, placeholder: 'gpt-4o' }] },
  { key: 'elevenlabs', name: 'ElevenLabs', desc: 'Realistic AI voices', icon: AudioLines, fields: [{ k: 'api_key', label: 'API Key', secret: true }] },
  { key: 'email', name: 'Email', desc: 'Transactional email (Resend)', icon: Mail, fields: [{ k: 'from_email', label: 'From email', placeholder: 'hello@yourbrand.com' }, { k: 'api_key', label: 'Resend API Key', secret: true, placeholder: 're_…' }] },
  { key: 'meta', name: 'Meta Business', desc: 'Facebook & Instagram', icon: Share2, oauth: true },
  { key: 'google', name: 'Google Business', desc: 'Google Business Profile', icon: Globe, oauth: true },
]

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'bg-green-50 text-green-700' },
  needs_attention: { label: 'Needs Attention', cls: 'bg-amber-50 text-amber-700' },
  not_connected: { label: 'Not Connected', cls: 'bg-gray-100 text-gray-500' },
}
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export function WholesaleInfrastructure({ onChange }: { onChange?: (connectedCount: number) => void }) {
  const [items, setItems] = useState<Integration[]>([])
  const [connect, setConnect] = useState<ProviderDef | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const j = await fetch('/api/partner/integrations').then((r) => r.json()).catch(() => null)
    if (j) { setItems(j.integrations || []); onChange?.((j.integrations || []).filter((i: Integration) => i.status === 'connected').length) }
  }, [onChange])
  useEffect(() => { load() }, [load])

  const byKey = (k: string) => items.find((i) => i.provider === k)
  async function reverify(provider: string) {
    setBusy(provider)
    const r = await fetch('/api/partner/integrations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
    const j = await r.json().catch(() => ({})); setBusy(null)
    toast[j.status === 'connected' ? 'success' : 'error'](j.status === 'connected' ? 'Reconnected' : (j.note || 'Still needs attention')); load()
  }
  async function disconnect(provider: string) {
    await fetch(`/api/partner/integrations?provider=${provider}`, { method: 'DELETE' }); toast.success('Disconnected'); load()
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PROVIDERS.map((p) => {
        const it = byKey(p.key)
        const status = it?.status || 'not_connected'
        const st = STATUS[status]
        return (
          <div key={p.key} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-subtle"><p.icon className="h-5 w-5" /></span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                {status === 'connected' ? <CheckCircle2 className="h-3 w-3" /> : status === 'needs_attention' ? <AlertTriangle className="h-3 w-3" /> : null}{st.label}
              </span>
            </div>
            <div className="mt-2 font-medium text-ink">{p.name}</div>
            <div className="text-xs text-subtle">{p.desc}</div>
            {it && status !== 'not_connected' && (
              <div className="mt-2 space-y-0.5 text-[11px] text-muted">
                {Object.entries(it.meta).filter(([, v]) => v).slice(0, 2).map(([k, v]) => <div key={k}>{k.replace(/_/g, ' ')}: <span className="text-subtle">{String(v)}</span></div>)}
                <div>Last sync: {fmt(it.last_verified_at)}{it.health != null ? ` · health ${it.health}` : ''}</div>
              </div>
            )}
            <div className="mt-3 flex flex-1 items-end gap-2">
              {p.oauth ? (
                <button disabled className="h-9 w-full rounded-lg border border-hairline-strong text-sm font-medium text-muted opacity-70">Connect (coming soon)</button>
              ) : status === 'not_connected' ? (
                <button onClick={() => setConnect(p)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><Plug className="h-4 w-4" /> Connect</button>
              ) : (
                <>
                  <button onClick={() => reverify(p.key)} disabled={busy === p.key} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">{busy === p.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recheck</button>
                  <button onClick={() => setConnect(p)} className="h-9 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-subtle hover:text-ink">Edit</button>
                  <button onClick={() => disconnect(p.key)} className="h-9 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-muted hover:text-red-600">Remove</button>
                </>
              )}
            </div>
          </div>
        )
      })}
      {connect && <ConnectModal provider={connect} onClose={() => setConnect(null)} onSaved={() => { setConnect(null); load() }} />}
    </div>
  )
}

function ConnectModal({ provider, onClose, onSaved }: { provider: ProviderDef; onClose: () => void; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const fields = provider.fields || []
  async function save(e: React.FormEvent) {
    e.preventDefault()
    for (const f of fields) if (!f.optional && !vals[f.k]?.trim()) return toast.error(`${f.label} is required`)
    setSaving(true)
    const r = await fetch('/api/partner/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider.key, credentials: vals }) })
    const j = await r.json().catch(() => ({})); setSaving(false)
    if (!r.ok) return toast.error(j.error || 'Failed')
    if (j.status === 'connected') toast.success(`${provider.name} connected`)
    else toast.error(j.note ? `Saved, but: ${j.note}` : `${provider.name} saved but not verified`)
    onSaved()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5"><div className="font-semibold text-ink">Connect {provider.name}</div><button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button></div>
        <form className="space-y-3 p-5" onSubmit={save}>
          <p className="text-xs text-subtle">Your credentials are encrypted and used only to run your clients&apos; workspaces. Scalix never bills these providers — you connect your own account.</p>
          {fields.map((f) => (
            <div key={f.k}><label className="mb-1 block text-xs font-medium text-subtle">{f.label}{f.optional && <span className="text-muted"> (optional)</span>}</label>
              <input type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={vals[f.k] || ''} onChange={(e) => setVals((v) => ({ ...v, [f.k]: e.target.value }))} className="h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" /></div>
          ))}
          <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button><button type="submit" disabled={saving} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect &amp; verify</button></div>
        </form>
      </div>
    </div>
  )
}
