'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Wallet, Zap, CalendarClock, TrendingUp, CreditCard, AlertTriangle, Phone, MessageSquare, Sparkles, Mail, HardDrive, MoreHorizontal } from 'lucide-react'
import { StatCard, Panel, money } from '@/components/partner/ui'
import { Switch } from '@/components/ui/switch'
import type { BalanceSummary } from '@/lib/billing/summary'

const PRESETS = [25000, 50000, 100000, 250000, 500000]
const CATEGORY_META: Record<string, { label: string; icon: typeof Phone }> = {
  voice: { label: 'Voice', icon: Phone },
  messaging: { label: 'Messaging', icon: MessageSquare },
  ai: { label: 'AI', icon: Sparkles },
  email: { label: 'Email', icon: Mail },
  storage: { label: 'Storage', icon: HardDrive },
  other: { label: 'Other', icon: MoreHorizontal },
}

export default function BalanceConsole({ initial }: { initial: BalanceSummary }) {
  const [s, setS] = useState<BalanceSummary>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const params = useSearchParams()

  async function refresh() {
    try { const r = await fetch('/api/partner/balance'); if (r.ok) setS(await r.json()) } catch { /* keep last */ }
  }
  useEffect(() => {
    const t = params.get('topup'); const c = params.get('card')
    if (t === 'success') { setMsg('Payment received — your balance will update momentarily.'); setTimeout(refresh, 2500) }
    else if (t === 'cancel') setMsg('Top-up canceled.')
    else if (c === 'saved') { setMsg('Card saved.'); refresh() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function post(body: Record<string, unknown>, tag: string) {
    setBusy(tag); setMsg(null)
    try {
      const r = await fetch('/api/partner/balance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) { setMsg(d.error || 'Something went wrong.'); return d }
      if (d.url) { window.location.href = d.url; return d }
      await refresh()
      return d
    } catch { setMsg('Network error.'); return {} } finally { setBusy(null) }
  }

  const paused = s.status !== 'active'
  const autoStatus = s.autoReload.enabled ? `On · below ${money(s.autoReload.thresholdCents ?? 0)}` : 'Off'
  const days = s.estimatedDaysRemaining

  return (
    <div className="space-y-6">
      {msg && <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-2.5 text-sm text-subtle">{msg}</div>}

      {(s.lowBalance || paused) && (
        <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${paused ? 'border-danger/30 bg-danger/[0.05] text-danger' : 'border-warning/30 bg-warning/[0.06] text-ink'}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">{paused ? 'Service paused — balance depleted' : 'Low balance'}</div>
            <div className="text-subtle">{paused ? 'New AI conversations, calls, and messages are paused. Add funds to resume — your data is safe.' : 'Add funds or enable auto-reload to avoid interruption.'}</div>
          </div>
        </div>
      )}

      {/* Top cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current Balance" value={money(s.balanceCents)} hint={paused ? 'Paused' : 'Active'} accent />
        <StatCard label="This Month's Usage" value={money(s.monthlyUsageCents)} hint="across all services" />
        <StatCard label="Auto Reload" value={s.autoReload.enabled ? 'On' : 'Off'} hint={s.autoReload.enabled ? autoStatus : 'not configured'} />
        <StatCard label="Est. Days Remaining" value={days == null ? '—' : String(days)} hint={days == null ? 'no recent usage' : 'at current usage'} />
      </div>

      {/* Add balance */}
      <Panel title="Add Balance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PRESETS.map((amt) => (
            <button key={amt} disabled={!!busy} onClick={() => post({ action: 'topup', amountCents: amt }, `t${amt}`)}
              className="rounded-xl border border-hairline-strong bg-surface px-3 py-4 text-lg font-semibold text-ink tabular-nums transition hover:border-accent hover:text-accent-strong disabled:opacity-50">
              {money(amt).replace('.00', '')}
            </button>
          ))}
          <div className="col-span-2 flex items-center gap-2 sm:col-span-3 lg:col-span-6">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">$</span>
              <input type="number" min={50} placeholder="Custom amount" value={custom} onChange={(e) => setCustom(e.target.value)}
                className="w-full rounded-xl border border-hairline-strong bg-surface py-2.5 pl-7 pr-3 text-ink tabular-nums" />
            </div>
            <button disabled={!!busy || !custom} onClick={() => post({ action: 'topup', amountCents: Math.round(Number(custom) * 100) }, 'tc')}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">Add funds</button>
          </div>
        </div>
      </Panel>

      {/* Auto reload */}
      <Panel title="Automatic Reload" action={
        <div className="flex items-center gap-3">
          <span className="text-sm text-subtle">{s.savedCard ? `${cap(s.savedCard.brand)} ···· ${s.savedCard.last4}` : 'No card'}</span>
          <button onClick={() => post({ action: 'add_card' }, 'card')} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink hover:border-accent">
            <CreditCard className="h-3.5 w-3.5" />{s.savedCard ? 'Update card' : 'Add card'}
          </button>
        </div>
      }>
        <AutoReload s={s} disabled={!!busy} onSave={(threshold, amount) => post({ action: 'auto_reload', enabled: true, thresholdCents: threshold, amountCents: amount }, 'ar')}
          onDisable={() => post({ action: 'auto_reload', enabled: false }, 'ar')} />
      </Panel>

      {/* Usage breakdown */}
      <Panel title="Usage This Month">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.keys(CATEGORY_META).map((c) => {
            const meta = CATEGORY_META[c]; const Icon = meta.icon; const cents = s.usageByCategory[c] || 0
            return (
              <div key={c} className="rounded-xl border border-hairline bg-surface p-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sunken text-accent-strong"><Icon className="h-4 w-4" /></div>
                <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{meta.label}</div>
                <div className="text-lg font-semibold text-ink tabular-nums">{money(cents)}</div>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* Transactions */}
      <Panel title="Transaction History">
        {s.transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline-strong px-4 py-8 text-center text-sm text-muted">No transactions yet.</div>
        ) : (
          <div className="divide-y divide-hairline">
            {s.transactions.map((t) => {
              const credit = t.amountCents >= 0
              return (
                <div key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-ink">{t.label}{t.category ? <span className="text-muted"> · {CATEGORY_META[t.category]?.label ?? t.category}</span> : null}</div>
                    <div className="text-xs text-subtle">{new Date(t.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={`font-semibold tabular-nums ${credit ? 'text-success' : 'text-ink'}`}>{credit ? '+' : '−'}{money(Math.abs(t.amountCents))}</div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

function AutoReload({ s, disabled, onSave, onDisable }: {
  s: BalanceSummary; disabled: boolean
  onSave: (thresholdCents: number, amountCents: number) => void; onDisable: () => void
}) {
  const [enabled, setEnabled] = useState(s.autoReload.enabled)
  const [threshold, setThreshold] = useState(String((s.autoReload.thresholdCents ?? 10000) / 100))
  const [amount, setAmount] = useState(String((s.autoReload.amountCents ?? 50000) / 100))
  useEffect(() => { setEnabled(s.autoReload.enabled) }, [s.autoReload.enabled])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-ink">Keep my balance funded automatically</div>
          <div className="text-xs text-subtle">When the balance drops below your threshold, we charge your saved card.</div>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); if (!v) onDisable() }} disabled={disabled || !s.savedCard} />
      </div>
      {enabled && (
        <div className="flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
          <Field label="When balance is below" prefix="$" value={threshold} onChange={setThreshold} />
          <Field label="Reload by" prefix="$" value={amount} onChange={setAmount} />
          <button disabled={disabled} onClick={() => onSave(Math.round(Number(threshold) * 100), Math.round(Number(amount) * 100))}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
        </div>
      )}
      {!s.savedCard && <div className="text-xs text-warning">Add a payment method above to enable auto-reload.</div>}
    </div>
  )
}

function Field({ label, prefix, value, onChange }: { label: string; prefix: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="relative w-36">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">{prefix}</span>
        <input type="number" min={50} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-hairline-strong bg-surface py-2 pl-7 pr-3 text-ink tabular-nums" />
      </div>
    </div>
  )
}
