'use client'

import { useEffect, useState } from 'react'

interface Partner {
  partnerId: string; name: string; activeClients: number; billedQuantity: number; platformStatus: string
  mrrCents: number; walletBalanceCents: number; walletReloadsCents: number
  usageRevenueCents: number; providerCostCents: number; markupRevenueCents: number
  platformRevenueCents: number; grossProfitCents: number; netProviderSpendCents: number; outstandingCents: number
}
interface Totals { activeClients: number; mrrCents: number; platformRevenueCents: number; usageRevenueCents: number; providerCostCents: number; grossProfitCents: number; outstandingCents: number }

// Result of a manual per-partner platform-fee sync (from POST …/partners/[id]/sync).
interface SyncResult { action: string; activeClients: number; billedQuantity: number; status: string; hasSubscription: boolean; syncedAt: string }
type SyncState = { loading?: boolean; result?: SyncResult; error?: string }

const money = (c: number) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AdminWlBillingPage() {
  const [d, setD] = useState<{ partners: Partner[]; totals: Totals; capabilities?: { canSync?: boolean } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [sync, setSync] = useState<Record<string, SyncState>>({})

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/wl-billing')
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'Failed to load')
        setD(j)
      } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
    })()
  }, [])

  // Manual, single-partner platform-fee reconcile (super-admin, Preview only). Never bulk.
  const runSync = async (partnerId: string) => {
    setSync((s) => ({ ...s, [partnerId]: { loading: true } }))
    try {
      const res = await fetch(`/api/admin/wl-billing/partners/${partnerId}/sync`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Sync failed (${res.status})`)
      setSync((s) => ({ ...s, [partnerId]: { result: j as SyncResult } }))
      // Reflect the freshly-synced quantity/status in the table row.
      setD((prev) => prev && ({
        ...prev,
        partners: prev.partners.map((p) => p.partnerId === partnerId
          ? { ...p, billedQuantity: j.billedQuantity, activeClients: j.activeClients, platformStatus: j.status }
          : p),
      }))
    } catch (e) {
      setSync((s) => ({ ...s, [partnerId]: { error: (e as Error).message } }))
    }
  }
  const canSync = !!d?.capabilities?.canSync

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone || 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs text-subtle">{sub}</div>}
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-1">White Label Billing</h1>
      <p className="text-sm text-subtle mb-6">Per-partner P&L across both billing systems — platform subscription + usage wallet. Internal only; provider cost never leaves this page.</p>

      {loading && <div className="text-sm text-subtle">Loading…</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
            <Tile label="Active Clients" value={String(d.totals.activeClients)} sub={`MRR ${money(d.totals.mrrCents)}`} />
            <Tile label="Platform Revenue" value={money(d.totals.platformRevenueCents)} sub="paid $97 invoices" />
            <Tile label="Usage Revenue" value={money(d.totals.usageRevenueCents)} sub={`provider cost ${money(d.totals.providerCostCents)}`} />
            <Tile label="Gross Profit" value={money(d.totals.grossProfitCents)} tone="text-emerald-600" sub={`outstanding ${money(d.totals.outstandingCents)}`} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle">
                <tr>
                  {['Partner', 'Active', 'Stored Qty', 'MRR', 'Platform Rev', 'Usage Rev', 'Provider Cost', 'Markup', 'Gross Profit', 'Wallet', 'Reloads', 'Outstanding', 'Status', ...(canSync ? ['Sync'] : [])].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {d.partners.map((p) => (
                  <tr key={p.partnerId}>
                    <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{p.name}</td>
                    <td className="px-3 py-2 tabular-nums">{p.activeClients}</td>
                    <td className="px-3 py-2 tabular-nums text-subtle">{p.billedQuantity}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.mrrCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.platformRevenueCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.usageRevenueCents)}</td>
                    <td className="px-3 py-2 tabular-nums text-subtle">{money(p.providerCostCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.markupRevenueCents)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-emerald-600">{money(p.grossProfitCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.walletBalanceCents)}</td>
                    <td className="px-3 py-2 tabular-nums text-subtle">{money(p.walletReloadsCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{p.outstandingCents ? money(p.outstandingCents) : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{p.platformStatus}</td>
                    {canSync && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => runSync(p.partnerId)}
                          disabled={sync[p.partnerId]?.loading}
                          className="rounded-lg border border-hairline-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-sunken disabled:opacity-50"
                        >
                          {sync[p.partnerId]?.loading ? 'Syncing…' : 'Sync platform subscription'}
                        </button>
                        {sync[p.partnerId]?.result && (
                          <div className="mt-1 text-xs text-subtle">
                            {sync[p.partnerId]!.result!.action} · qty {sync[p.partnerId]!.result!.billedQuantity} · {sync[p.partnerId]!.result!.status}
                            <span className="block text-[11px] text-subtle/70">synced {new Date(sync[p.partnerId]!.result!.syncedAt).toLocaleTimeString()}</span>
                          </div>
                        )}
                        {sync[p.partnerId]?.error && (
                          <div className="mt-1 text-xs text-red-600">{sync[p.partnerId]!.error}</div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {d.partners.length === 0 && (
                  <tr><td colSpan={canSync ? 14 : 13} className="px-3 py-8 text-center text-subtle">No White Label partners yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
