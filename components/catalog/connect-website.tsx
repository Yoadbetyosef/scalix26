'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Globe, Loader2, RefreshCw, Upload, Link2, Plus, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { IngestedProducts } from './ingested-products'

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

  // A SECTION, NOT A CARD-INSIDE-A-PAGE. v1 boxed this panel and then boxed the source rows inside
  // it and the failure state inside those — three nested borders before a sentence. In this language
  // a section is a micro-label and a rule, and the rows below it are the same list row the catalogue
  // itself uses, so "your website" and "your products" read as two parts of one page.
  return (
    <div className="mb-6">
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Your website</p>
        <s />
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <Plus className="w-3.5 h-3.5" /> Connect a site
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4">
          <div className="v2-fld">
            <label htmlFor="connect-url">Website address</label>
            <input
              id="connect-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && owns && url.trim()) void connect() }}
              placeholder="yourshop.com"
              autoFocus
            />
          </div>

          {/* Not decoration: this is the tenant stating they're entitled to the content we're about
              to read. The server refuses the request without it. */}
          <label className="v2-check" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
            <input type="checkbox" checked={owns} onChange={(e) => setOwns(e.target.checked)} />
            <span>I confirm I own or am authorized to use this website’s content.</span>
          </label>

          {error && (
            <div className="v2-notice mt-3" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
              <span className="v2-chip-sq"><AlertCircle /></span>
              <p>{error}</p>
            </div>
          )}

          <div className="v2-bar mt-4">
            <button
              onClick={() => void connect()}
              disabled={!owns || !url.trim() || connecting}
              className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)' }}
            >
              {connecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking at your site…</> : 'Connect'}
            </button>
            <button onClick={() => { setShowForm(false); setError(null) }} className="v2-act tap-target">
              Cancel
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showForm && (
        <div className="v2-card" data-empty>
          <b>No site connected</b>
          <span>Connect your website and we’ll read your products from it — so the AI can answer questions about what you sell.</span>
        </div>
      )}

      {sources.length > 0 && (
        <div className="v2-list">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} onResync={() => void resync(s.id)} onDisconnect={() => void disconnect(s.id)} onUpload={() => fileRef.current?.click()} />
          ))}
        </div>
      )}

      {/* What those sources actually captured. Directly under them on purpose: everything here comes
          from the website, and the physical inventory list lives further down the page. */}
      <IngestedProducts />

      <input
        ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCsv(f); e.target.value = '' }}
      />
      {uploading && <p className="v2-kick mt-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading your file…</p>}
    </div>
  )
}

function SourceRow({ source, onResync, onDisconnect, onUpload }: {
  source: Source; onResync: () => void; onDisconnect: () => void; onUpload: () => void
}) {
  const host = source.source_url.replace(/^https?:\/\//, '').replace(/^file:\/\//, '')
  const failed = source.status === 'failed'
  const working = source.status === 'detecting' || source.status === 'syncing' || source.status === 'pending'
  // The row's own hue says its state without a second badge: amber while it is still going, red when
  // it could not be read, and the violet this whole section is keyed to once it is up to date.
  const hue = failed ? 'var(--v2-red)' : working ? 'var(--v2-amber)' : 'var(--v2-t3)'

  return (
    <div style={{ ['--chan' as string]: hue }}>
      <div className="v2-row" style={{ borderBottom: failed || working ? 0 : undefined }}>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: hue }}><Globe /></span>
        <div className="v2-m">
          <p><span className="truncate">{host}</span></p>
          <span>
            {failed ? 'Not connected'
              : working ? (source.status === 'detecting' ? 'Working out what your site runs on…' : 'Reading your products…')
              : <>{source.detected_platform || PLATFORM_LABEL[source.source_type] || 'Website'} · {source.products_found} products · synced {timeAgo(source.last_synced_at)}</>}
          </span>
        </div>
        {source.status === 'active' && (
          <span className="v2-stat" style={{ ['--chan' as string]: hue }}><CheckCircle2 className="w-3 h-3" /> Up to date</span>
        )}
        <div className="flex items-center gap-1 flex-none">
          {source.status === 'active' && (
            <button onClick={onResync} title="Sync now" aria-label="Sync now" className="v2-ico" style={{ ['--ghue' as string]: hue }}><RefreshCw /></button>
          )}
          <button onClick={onDisconnect} title="Disconnect" aria-label="Disconnect" className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }}><X /></button>
        </div>
      </div>

      {working && <Progress progress={source.progress} />}

      {failed && <FailureState reason={source.last_status} detail={source.error_log?.[0]?.message ?? null} onUpload={onUpload} />}
    </div>
  )
}

// The tab's gradient underline, doing a second job. A progress bar in this language is a rule that
// fills, not a pill inside a track — same 2px, same gradient, same radius as the mark under a
// selected tab, so nothing new has to be learned to read it.
function Progress({ progress }: { progress: Source['progress'] }) {
  const current = progress?.current ?? 0
  const total = progress?.total ?? null
  const pct = total && total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <div style={{ height: 2, borderRadius: 2, background: 'var(--v2-line)', overflow: 'hidden' }}>
        <div
          className={pct === null ? 'animate-pulse' : undefined}
          style={{
            height: '100%', borderRadius: 2,
            background: 'linear-gradient(90deg, var(--v2-t1), var(--v2-t3) 60%, var(--v2-t4))',
            width: pct === null ? '33%' : `${pct}%`,
            transition: 'width 0.5s',
          }}
        />
      </div>
      <p className="v2-kick" style={{ marginTop: 8 }}>
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
    <div style={{ padding: '0 14px 16px' }}>
      <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start' }}>
        <span className="v2-chip-sq"><AlertCircle /></span>
        <p>
          {copy.title}
          <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>{copy.body}</span>
          {detail && reason !== 'spa_unsupported' && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 400, color: 'var(--v2-mute)' }}>{detail}</span>
          )}
          <span className="v2-bar" style={{ marginTop: 12 }}>
            <button onClick={onUpload} className="v2-act tap-target"><Upload className="w-3.5 h-3.5" /> Upload a spreadsheet</button>
            <Link href="/catalog/new" className="v2-act tap-target"><Plus className="w-3.5 h-3.5" /> Add by hand</Link>
            <a href="mailto:support@scalix26.com?subject=Help%20connecting%20my%20product%20catalog" className="v2-act tap-target"><Link2 className="w-3.5 h-3.5" /> Send us the links</a>
          </span>
        </p>
      </div>
    </div>
  )
}
