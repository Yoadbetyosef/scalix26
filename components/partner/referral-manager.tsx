'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { Panel, EmptyRow } from '@/components/partner/ui'
import { Copy, QrCode, Plus, Download, ExternalLink, Share2 } from 'lucide-react'

interface Link { id: string; code: string; label: string | null; destination_path: string; click_count: number; conversions: { signups: number; paid: number } }

export function ReferralManager() {
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [dest, setDest] = useState('/auth/signup')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<{ code: string; url: string; data: string } | null>(null)
  const [origin, setOrigin] = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => {
    const res = await fetch('/api/partner/links'); const j = await res.json()
    setLinks(j.links || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const shareUrl = (code: string) => `${origin}/r/${code}`

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const res = await fetch('/api/partner/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, destination_path: dest }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    toast.success('Link created'); setLabel(''); load()
  }

  function copy(code: string) { navigator.clipboard.writeText(shareUrl(code)); toast.success('Link copied') }

  const PITCH = 'Give your business a 24/7 AI employee that answers every call & text and books the job. Try it free:'
  function share(net: string, code: string) {
    const url = encodeURIComponent(shareUrl(code))
    const text = encodeURIComponent(PITCH)
    const map: Record<string, string> = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      whatsapp: `https://wa.me/?text=${text}%20${url}`,
      email: `mailto:?subject=${encodeURIComponent('A 24/7 AI employee for your business')}&body=${text}%20${url}`,
    }
    if (net === 'instagram') { navigator.clipboard.writeText(shareUrl(code)); return toast.success('Link copied — paste it in your IG bio or story') }
    window.open(map[net], '_blank', 'noopener,width=640,height=560')
  }

  async function showQr(code: string) {
    const url = shareUrl(code)
    const data = await QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: '#1A1F36', light: '#FFFFFF' } })
    setQr({ code, url, data })
  }
  function downloadQr() {
    if (!qr) return
    const a = document.createElement('a'); a.href = qr.data; a.download = `scalix-referral-${qr.code}.png`; a.click()
  }

  return (
    <div className="space-y-6">
      <Panel title="Create a referral link">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Instagram bio)"
            className="h-10 flex-1 min-w-[200px] rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />
          <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-10 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent">
            <option value="/auth/signup">→ Signup</option>
            <option value="/">→ Home</option>
          </select>
          <button disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">
            <Plus className="h-4 w-4" /> Create
          </button>
        </form>
      </Panel>

      <Panel title="Your links">
        {loading ? <EmptyRow>Loading…</EmptyRow> : links.length === 0 ? <EmptyRow>No links yet — create your first above.</EmptyRow> : (
          <div className="divide-y divide-hairline">
            {links.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <span className="font-medium">{l.label || 'Referral link'}</span>
                    <a href={shareUrl(l.code)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-strong hover:underline">
                      /r/{l.code} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{l.click_count} clicks · {l.conversions.signups} signups · {l.conversions.paid} paid</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button onClick={() => copy(l.code)} title="Copy link" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:text-ink"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => showQr(l.code)} title="QR code" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:text-ink"><QrCode className="h-4 w-4" /></button>
                  <span className="mx-1 hidden h-5 w-px bg-hairline sm:block" />
                  <Share2 className="hidden h-3.5 w-3.5 text-muted sm:block" />
                  {([['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp'], ['x', 'X'], ['instagram', 'Instagram'], ['email', 'Email']] as const).map(([net, label]) => (
                    <button key={net} onClick={() => share(net, l.code)} className="rounded-md border border-hairline px-2 py-1 text-[11px] font-medium text-subtle transition-colors hover:border-accent hover:text-accent-strong">{label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQr(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.data} alt="QR code" className="mx-auto h-56 w-56" />
            <div className="mt-2 break-all text-xs text-muted">{qr.url}</div>
            <button onClick={downloadQr} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white">
              <Download className="h-4 w-4" /> Download PNG
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
