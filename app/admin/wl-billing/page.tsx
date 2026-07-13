'use client'

import { useEffect, useState } from 'react'

interface Partner {
  partnerId: string; name: string; activeClients: number; platformStatus: string
  mrrCents: number; walletBalanceCents: number; walletReloadsCents: number
  usageRevenueCents: number; providerCostCents: number; markupRevenueCents: number
  platformRevenueCents: number; grossProfitCents: number; netProviderSpendCents: number; outstandingCents: number
}
interface Totals { activeClients: number; mrrCents: number; platformRevenueCents: number; usageRevenueCents: number; providerCostCents: number; grossProfitCents: number; outstandingCents: number }

const money = (c: number) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AdminWlBillingPage() {
  const [d, setD] = useState<{ partners: Partner[]; totals: Totals } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

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
                  {['Partner', 'Active', 'MRR', 'Platform Rev', 'Usage Rev', 'Provider Cost', 'Markup', 'Gross Profit', 'Wallet', 'Reloads', 'Outstanding', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {d.partners.map((p) => (
                  <tr key={p.partnerId}>
                    <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{p.name}</td>
                    <td className="px-3 py-2 tabular-nums">{p.activeClients}</td>
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
                  </tr>
                ))}
                {d.partners.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-subtle">No White Label partners yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
