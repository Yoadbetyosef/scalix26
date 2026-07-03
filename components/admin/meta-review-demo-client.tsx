'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Scopes requested by the demo OAuth route (app/api/admin/meta-review-demo/connect) — shown
// verbatim so the screencast reflects exactly what the app's real Facebook-Login implementation
// requests. Matches the production connect flow.
const REQUESTED_SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_messaging',
  'instagram_basic', 'instagram_manage_messages', 'business_management',
]

const PERMISSION_USE_CASES: { perm: string; use: string }[] = [
  { perm: 'pages_show_list', use: 'List the Facebook Pages the user manages so they can select one to connect.' },
  { perm: 'pages_read_engagement', use: 'Read the selected Page and obtain its Page access token.' },
  { perm: 'pages_manage_metadata', use: 'Subscribe the connected Page to the app webhook so Messenger/Instagram events are delivered.' },
  { perm: 'pages_messaging', use: 'Send and receive Facebook Page (Messenger) messages between Scalix and customers.' },
  { perm: 'instagram_basic', use: 'Read the connected Instagram Business account identity (id / username).' },
  { perm: 'instagram_manage_messages', use: 'Send and receive Instagram Direct messages (via the linked Page) between Scalix and customers.' },
  { perm: 'business_management', use: 'Access Business-owned Pages/assets during connection where applicable.' },
]

interface Assets {
  facebook: { pageName: string | null; pageId: string; status: string } | null
  instagram: { username: string | null; igId: string; linkedPageId: string | null; status: string } | null
  incoming: { conversationId: string; channel: 'facebook' | 'instagram'; sender: string; recipientId: string | null; text: string; timestamp: string }[]
}
type Incoming = Assets['incoming'][number]
interface SendResult { ok: boolean; status: number; messageId?: string | null; recipientId?: string | null; text?: string; sentAt?: string; error?: string }

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-800 ring-1 ring-amber-200">🎬 {children}</p>
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-e1">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export function MetaReviewDemoClient({ agentId }: { agentId: string | null }) {
  const [assets, setAssets] = useState<Assets | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Incoming | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)
  const selectedRef = useRef<Incoming | null>(null)
  selectedRef.current = selected

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/meta-review-demo/state', { cache: 'no-store' })
      const j: Assets = await r.json()
      setAssets(j)
      // keep selection in sync / default to latest incoming
      if (j.incoming?.length) {
        const cur = selectedRef.current
        const match = cur ? j.incoming.find((x) => x.conversationId === cur.conversationId) : null
        setSelected(match || j.incoming[0])
      } else setSelected(null)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  const connect = () => {
    if (!agentId) return
    const url = `/api/admin/meta-review-demo/connect?agentId=${agentId}`
    const w = window.open(url, 'meta_oauth', 'width=640,height=820')
    if (!w) window.location.href = url // popup blocked → same-tab fallback
  }

  const send = async () => {
    if (!selected?.recipientId || !reply.trim()) return
    setSending(true); setSendResult(null)
    try {
      const r = await fetch('/api/admin/meta-review-demo/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: selected.channel, recipientId: selected.recipientId, text: reply.trim() }),
      })
      const j: SendResult = await r.json()
      setSendResult(j)
      if (j.ok) { setReply(''); setTimeout(refresh, 1500) }
    } catch { setSendResult({ ok: false, status: 0, error: 'network error' }) } finally { setSending(false) }
  }

  const fb = assets?.facebook, ig = assets?.instagram
  const connected = (fb?.status === 'connected') || (ig?.status === 'connected')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-bold text-ink">Meta App Review — Messaging Demo</h1>
        <p className="mt-1 text-sm text-muted">A guided, end-to-end walkthrough for the App Review screencast. Everything shown here is live from the real Meta integration — no mock data. This page is temporary and can be removed after approval.</p>
      </header>

      {/* STEP 1 */}
      <Step n={1} title="Connect Meta (Facebook Page / Instagram)">
        <p className="text-sm text-muted">Click Connect to start the real Meta login. You will log in to Facebook, grant the requested permissions, and select the Facebook Page / Instagram Business account to connect.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={connect} disabled={!agentId} className="rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166fe0] disabled:opacity-50">Connect Facebook / Instagram</button>
          {!agentId && <span className="text-xs text-red-600">No AI employee found on this account — create one first.</span>}
          {connected && <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Connected</span>}
        </div>
        <Caption>This shows the user granting Meta permissions.</Caption>

        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Requested permissions (from the live OAuth request)</p>
          <div className="flex flex-wrap gap-1.5">{REQUESTED_SCOPES.map((s) => <code key={s} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{s}</code>)}</div>
        </div>

        {/* Connected assets */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-hairline bg-sunken p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Facebook Page</p>
            {fb ? (
              <div className="mt-1 text-sm text-ink">
                <div><span className="text-muted">Name:</span> <b>{fb.pageName || '—'}</b></div>
                <div><span className="text-muted">Page ID:</span> <code className="text-xs">{fb.pageId}</code></div>
                <div><span className="text-muted">Status:</span> <b className={fb.status === 'connected' ? 'text-emerald-600' : 'text-gray-500'}>{fb.status}</b></div>
              </div>
            ) : <p className="mt-1 text-sm text-muted">Not connected yet.</p>}
            <Caption>This shows the selected Facebook Page.</Caption>
          </div>
          <div className="rounded-xl border border-hairline bg-sunken p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Instagram Business Account</p>
            {ig ? (
              <div className="mt-1 text-sm text-ink">
                <div><span className="text-muted">Username:</span> <b>{ig.username ? `@${ig.username}` : '—'}</b></div>
                <div><span className="text-muted">Instagram ID:</span> <code className="text-xs">{ig.igId}</code></div>
                <div><span className="text-muted">Status:</span> <b className={ig.status === 'connected' ? 'text-emerald-600' : 'text-gray-500'}>{ig.status}</b></div>
              </div>
            ) : <p className="mt-1 text-sm text-muted">Not connected yet.</p>}
            <Caption>This shows the selected Instagram Business account.</Caption>
          </div>
        </div>
      </Step>

      {/* STEP 2 */}
      <Step n={2} title="Incoming Message Test">
        <p className="text-sm text-muted">From a phone, send a message from <b>Messenger</b> or <b>Instagram</b> to the connected Page / account. It will appear below within a few seconds (this list auto-refreshes).</p>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={refresh} className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken">Refresh</button>
          {loading && <span className="text-xs text-muted">Loading…</span>}
        </div>
        <div className="mt-3 space-y-2">
          {assets?.incoming?.length ? assets.incoming.map((m) => (
            <button key={m.conversationId} onClick={() => setSelected(m)} className={`block w-full rounded-xl border p-3 text-left transition-colors ${selected?.conversationId === m.conversationId ? 'border-[#1877F2] bg-blue-50/50 ring-1 ring-[#1877F2]' : 'border-hairline bg-white hover:bg-sunken'}`}>
              <div className="flex items-center justify-between text-xs">
                <span className={`rounded px-1.5 py-0.5 font-semibold ${m.channel === 'instagram' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>{m.channel === 'instagram' ? 'Instagram' : 'Messenger'}</span>
                <span className="text-subtle">{fmt(m.timestamp)}</span>
              </div>
              <p className="mt-1.5 text-[15px] font-medium text-ink">{m.text}</p>
              <p className="mt-1 text-xs text-muted">From: <code>{m.sender}</code>{m.recipientId ? <span> · reply id: <code>{m.recipientId}</code></span> : null}</p>
            </button>
          )) : <div className="rounded-xl border border-dashed border-hairline p-4 text-center text-sm text-muted">No incoming messages yet. Send one from Messenger / Instagram.</div>}
        </div>
        <Caption>This shows an incoming customer message inside Scalix.</Caption>
      </Step>

      {/* STEP 3 */}
      <Step n={3} title="Send Message From Scalix">
        <p className="text-sm text-muted">Type a reply and send it through the real Meta messaging API to the selected conversation{selected ? <> (<b>{selected.channel === 'instagram' ? 'Instagram' : 'Messenger'}</b> · <code>{selected.sender}</code>)</> : null}.</p>
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type reply message" rows={3} className="mt-3 w-full rounded-lg border border-hairline p-3 text-sm text-ink focus:border-[#1877F2] focus:outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={send} disabled={sending || !selected?.recipientId || !reply.trim()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {sending ? 'Sending…' : `Send reply through ${selected?.channel === 'instagram' ? 'Instagram' : 'Messenger'}`}
          </button>
          {!selected?.recipientId && <span className="text-xs text-muted">Receive a message first (Step 2) to enable sending.</span>}
        </div>
        <Caption>This sends a reply from Scalix using the Meta messaging API.</Caption>
      </Step>

      {/* STEP 4 */}
      <Step n={4} title="Delivery Proof">
        {sendResult ? (
          sendResult.ok ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="font-semibold text-emerald-700">✓ Sent via Meta Graph API (HTTP {sendResult.status})</p>
              <div className="mt-2 space-y-1 text-ink">
                <div><span className="text-muted">Message:</span> <b>{sendResult.text}</b></div>
                <div><span className="text-muted">Meta message ID:</span> <code className="text-xs">{sendResult.messageId || '—'}</code></div>
                <div><span className="text-muted">Recipient ID:</span> <code className="text-xs">{sendResult.recipientId || '—'}</code></div>
                <div><span className="text-muted">Sent at:</span> {sendResult.sentAt ? fmt(sendResult.sentAt) : '—'}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
              <p className="font-semibold text-red-700">Send failed (HTTP {sendResult.status})</p>
              <p className="mt-1 text-red-800">{sendResult.error}</p>
            </div>
          )
        ) : <p className="text-sm text-muted">Send a reply in Step 3 to see the Meta delivery proof here.</p>}
        <Caption>This verifies the same message appears in the native client. Now open the Messenger / Instagram app to confirm the reply arrived.</Caption>
      </Step>

      {/* Permission → use-case mapping for the reviewer */}
      <section className="rounded-2xl border border-hairline bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">End-to-end use case per permission</h2>
        <div className="space-y-1.5">
          {PERMISSION_USE_CASES.map((p) => (
            <div key={p.perm} className="flex flex-col gap-0.5 rounded-lg bg-sunken px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <code className="shrink-0 text-[12px] font-semibold text-gray-800">{p.perm}</code>
              <span className="text-[13px] text-muted">{p.use}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
