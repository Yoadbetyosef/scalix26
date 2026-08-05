'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Globe, Loader2, RefreshCw, Upload, Link2, Plus, CheckCircle2, AlertCircle, X } from 'lucide-react'

// "Connect your website" — paste a URL, and the products a business already publishes become
// something the AI can answer questions from.
//
// The failure path is the part that matters most. Plenty of real shops are single-page apps, or have
// a robots.txt that says no, and for those tenants this panel is the whole feature. So a site we
// can't read is not an error dump: it is a sentence explaining what happened and three things they
// can do next, styled exactly like the success path.

interface Source {
  id: string
  source_url: string
  source_type: string
  detected_platform: string | null
  status: 'pending' | 'detecting' | 'syncing' | 'active' | 'failed' | 'paused'
  last_synced_at: string | null
  last_status: string | null
  products_found: number
  progress: { current: number; total: number | null; phase: string } | null
  error_log: Array<{ at: string; reason: string; message: string }> | null
}

const PLATFORM_LABEL: Record<string, string> = {
  shopify_api: 'Shopify', woocommerce_api: 'WooCommerce', product_feed: 'Product feed',
  jsonld_crawl: 'Website', html_ai: 'Website', csv_upload: 'Uploaded file', manual: 'Not detected yet',
}

// One sentence per reason, written for the person who owns the site — not the log line.
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  spa_unsupported: {
    title: 'We couldn’t read this site automatically',
    body: 'Your site builds its pages in the browser, so there’s nothing for us to read on the server. That’s normal for newer site builders — the options below work just as well.',
  },
  robots_blocked: {
    title: 'Your site is asking us not to read it',
    body: 'The robots.txt file on your site tells automated readers to stay out of your product pages. It’s your file, so you can change it — add “User-agent: ScalixBot” followed by “Allow: /” and try again. Or use one of the options below.',
  },
  unreachable: {
    title: 'Your site didn’t respond',
    body: 'We couldn’t reach that address. Check the spelling, and that the site is live — then try again.',
  },
  low_confidence: {
    title: 'This doesn’t look like a shop to us',
    body: 'We read a few pages of your site and none of them looked like a product page — no prices, no product codes. If you do sell online, the options below will get your list in directly.',
  },
  no_products_found: {
    title: 'We couldn’t find any products',
    body: 'We reached your site but nothing on it looked like a product page. If your products live somewhere else — a marketplace, a PDF, a spreadsheet — the options below will get them in.',
  },
  default: {
    title: 'We couldn’t read this site automatically',
    body: 'Something on that site stopped us from reading it. You can try again, or use one of the options below.',
  },
}

const timeAgo = (iso: string | null): string => {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ConnectWebsite({ onProductsChanged }: { onProductsChanged?: () => void }) {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [owns, setOwns] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/catalog/sources')
      if (!res.ok) { setSources([]); return }
      const json = await res.json()
      setSources(json.sources ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  // Poll only while something is actually moving — a finished panel makes no requests.
  const busy = sources.some((s) => s.status === 'detecting' || s.status === 'syncing' || s.status === 'pending')
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => { void load().then(() => onProductsChanged?.()) }, 3000)
    return () => clearInterval(t)
  }, [busy, load, onProductsChanged])

  async function connect() {
    setError(null)
    setConnecting(true)
    try {
      const res = await fetch('/api/catalog/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ownershipConfirmed: owns }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not connect that site.'); return }
      setUrl(''); setOwns(false); setShowForm(false)
      await load()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally { setConnecting(false) }
  }

  async function resync(id: string) {
    await fetch(`/api/catalog/sources/${id}/sync`, { method: 'POST' })
    await load()
  }

  async function disconnect(id: string) {
    await fetch(`/api/catalog/sources/${id}`, { method: 'DELETE' })
    await load()
    onProductsChanged?.()
  }

  async function uploadCsv(file: File) {
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/catalog/import/csv', { method: 'POST', body })
      const json = await res.json()
      if (json.needsMapping || !res.ok) { setError(json.error ?? 'We could not read that file.'); return }
      await load()
    } finally { setUploading(false) }
  }

  if (loading) return null

  return (
    <div className="mb-4 rounded-xl border border-hairline-strong bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold text-ink">Your website</h2>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"
          >
            <Plus className="h-4 w-4" /> Connect a site
          </button>
        )}
      </div>

      {showForm && (
        <div className="border-b border-hairline px-4 py-4">
          <label className="block text-xs font-medium text-subtle">
            Website address
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && owns && url.trim()) void connect() }}
              placeholder="yourshop.com"
              autoFocus
              className="mt-1 h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </label>

          {/* Not decoration: this is the tenant stating they're entitled to the content we're about
              to read. The server refuses the request without it. */}
          <label className="mt-3 flex items-start gap-2 text-sm text-subtle">
            <input type="checkbox" checked={owns} onChange={(e) => setOwns(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-hairline-strong" />
            <span>I confirm I own or am authorized to use this website’s content.</span>
          </label>

          {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void connect()}
              disabled={!owns || !url.trim() || connecting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-40"
            >
              {connecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Looking at your site…</> : 'Connect'}
            </button>
            <button onClick={() => { setShowForm(false); setError(null) }} className="rounded-lg px-3 py-2 text-sm text-subtle hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showForm && (
        <p className="px-4 py-4 text-sm text-muted">
          Connect your website and we’ll read your products from it — so the AI can answer questions about what you sell.
        </p>
      )}

      <div className="divide-y divide-hairline">
        {sources.map((s) => (
          <SourceRow key={s.id} source={s} onResync={() => void resync(s.id)} onDisconnect={() => void disconnect(s.id)} onUpload={() => fileRef.current?.click()} />
        ))}
      </div>

      <input
        ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCsv(f); e.target.value = '' }}
      />
      {uploading && <p className="px-4 py-3 text-sm text-muted"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> Reading your file…</p>}
    </div>
  )
}

function SourceRow({ source, onResync, onDisconnect, onUpload }: {
  source: Source; onResync: () => void; onDisconnect: () => void; onUpload: () => void
}) {
  const host = source.source_url.replace(/^https?:\/\//, '').replace(/^file:\/\//, '')
  const failed = source.status === 'failed'
  const working = source.status === 'detecting' || source.status === 'syncing' || source.status === 'pending'

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{host}</p>
          <p className="mt-0.5 text-xs text-subtle">
            {failed ? 'Not connected'
              : working ? (source.status === 'detecting' ? 'Working out what your site runs on…' : 'Reading your products…')
              : <>{source.detected_platform || PLATFORM_LABEL[source.source_type] || 'Website'} · {source.products_found} products · synced {timeAgo(source.last_synced_at)}</>}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {source.status === 'active' && (
            <button onClick={onResync} title="Sync now" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:bg-sunken hover:text-ink">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={onDisconnect} title="Disconnect" className="rounded-lg border border-hairline-strong p-2 text-subtle hover:bg-sunken hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {working && <Progress progress={source.progress} />}

      {source.status === 'active' && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
        </p>
      )}

      {failed && <FailureState reason={source.last_status} detail={source.error_log?.[0]?.message ?? null} onUpload={onUpload} />}
    </div>
  )
}

function Progress({ progress }: { progress: Source['progress'] }) {
  const current = progress?.current ?? 0
  const total = progress?.total ?? null
  const pct = total && total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null

  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full bg-accent transition-all duration-500 ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">
        {progress?.phase ?? 'starting'}{current > 0 && ` · ${current}${total ? ` of ${total}` : ''} products`}
      </p>
    </div>
  )
}

// The three ways forward. Deliberately the same weight as the success path — for a business on a
// site builder we can't read, this IS the feature, and it should not look like a consolation prize.
function FailureState({ reason, detail, onUpload }: { reason: string | null; detail: string | null; onUpload: () => void }) {
  const copy = FAILURE_COPY[reason ?? 'default'] ?? FAILURE_COPY.default

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="flex items-start gap-2 text-sm font-medium text-ink">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        {copy.title}
      </p>
      <p className="mt-1 pl-6 text-sm text-subtle">{copy.body}</p>
      {detail && reason !== 'spa_unsupported' && <p className="mt-1 pl-6 text-xs text-muted">{detail}</p>}

      <div className="mt-3 flex flex-wrap gap-2 pl-6">
        <button onClick={onUpload} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-sunken">
          <Upload className="h-4 w-4" /> Upload a spreadsheet
        </button>
        <Link href="/catalog/new" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-sunken">
          <Plus className="h-4 w-4" /> Add products by hand
        </Link>
        <a href="mailto:support@scalix26.com?subject=Help%20connecting%20my%20product%20catalog" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-sunken">
          <Link2 className="h-4 w-4" /> Send us the links
        </a>
      </div>
    </div>
  )
}
