'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Plus, ArrowRight, Bot, Loader2, CheckCircle2, PartyPopper, UserPlus } from 'lucide-react'
import { money } from '@/components/partner/ui'
import { ProvisionClientWizard } from '@/components/partner/provision-client-wizard'
import { ClientInvitePanel } from '@/components/partner/client-invite-panel'
import type { BusinessCard } from '@/lib/partner/company'
import type { PriceBook } from '@/lib/partner/wholesale'

const INVITE_CHIP: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Invite sent', cls: 'bg-blue-50 text-blue-700' },
  pending: { label: 'Invite opened', cls: 'bg-amber-50 text-amber-700' },
  accepted: { label: 'Owner active', cls: 'bg-emerald-50 text-emerald-700' },
  expired: { label: 'Invite expired', cls: 'bg-red-50 text-red-600' },
  revoked: { label: 'Invite revoked', cls: 'bg-red-50 text-red-600' },
}

const rel = (iso: string | null) => {
  if (!iso) return 'No activity yet'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'Active just now'
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`
  return `Active ${Math.floor(s / 86400)}d ago`
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  return (
    <div className="flex h-8 items-end gap-[3px]">
      {data.map((v, i) => (
        <span key={i} className="w-full rounded-sm bg-accent/25" style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}

type Wizard = { book: PriceBook | null; discount: number | null; markup: number | null }

export function BusinessesGrid({ businesses, wizard, autoNew, mrrCents }: {
  businesses: BusinessCard[]
  wizard: Wizard
  autoNew?: boolean
  mrrCents: number
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'attention'>('all')
  const [wizardOpen, setWizardOpen] = useState(!!autoNew)
  const [entering, setEntering] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ tenant_id: string; business_name: string } | null>(null)
  const [invite, setInvite] = useState<{ tenantId: string; name: string } | null>(null)

  useEffect(() => { if (autoNew) setWizardOpen(true) }, [autoNew])

  const filtered = useMemo(() => businesses.filter((b) => {
    if (q && !b.name.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'active') return b.status === 'active' && !b.needsAttention
    if (filter === 'attention') return b.needsAttention
    return true
  }), [businesses, q, filter])

  async function enter(tenantId: string | null) {
    if (!tenantId) return
    setEntering(tenantId)
    const r = await fetch('/api/partner/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', tenantId }) })
    if (!r.ok) { setEntering(null); return toast.error('Could not open this business') }
    window.location.href = '/dashboard'
  }

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'attention', label: 'Needs attention' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Businesses</h1>
          <p className="mt-1 text-sm text-subtle">
            {businesses.length} {businesses.length === 1 ? 'business' : 'businesses'}{mrrCents > 0 ? ` · ${money(mrrCents)} MRR` : ''}
          </p>
        </div>
        <button onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-e2 transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.98]">
          <Plus className="h-4 w-4" /> New Business
        </button>
      </div>

      {/* Search + filters */}
      {businesses.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search businesses…"
              className="h-11 w-full rounded-xl border border-hairline bg-surface pl-10 pr-4 text-sm text-ink outline-none transition-shadow focus:border-accent/40 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_10%,transparent)]" />
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-hairline bg-surface p-1">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${filter === f.key ? 'bg-accent/10 text-accent-strong' : 'text-subtle hover:text-ink'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 sx-stagger">
        {filtered.map((b) => (
          <div key={b.id}
            className="group flex flex-col rounded-2xl border border-hairline bg-surface p-5 shadow-e1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-e2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${b.needsAttention ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <h3 className="truncate text-[15px] font-semibold text-ink">{b.name}</h3>
                </div>
                <p className="mt-1 text-xs text-subtle">
                  {b.planLabel || 'No plan'}{b.mrrCents > 0 ? ` · ${money(b.mrrCents)}/mo` : ''}
                </p>
              </div>
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-subtle">
                <Bot className="h-3 w-3" /> {b.aiCount}
              </span>
            </div>

            {b.needsAttention ? (
              <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-700">Setup incomplete — finish to go live</div>
            ) : (
              <div className="mt-4 flex items-end justify-between gap-3">
                <Sparkline data={b.spark} />
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink">{b.weekMessages}</div>
                  <div className="text-[11px] text-muted">msgs / wk</div>
                </div>
              </div>
            )}

            {/* Owner access status — a scannable signal for a company running thousands of accounts. */}
            {b.tenantId && (() => {
              const chip = b.ownerLinked ? INVITE_CHIP.accepted : INVITE_CHIP[b.inviteStatus]
              return (
                <div className="mt-3 flex items-center gap-2">
                  {chip
                    ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.label}</span>
                    : <span className="text-[11px] text-muted">Owner not invited</span>}
                  {!b.ownerLinked && (
                    <button onClick={() => setInvite({ tenantId: b.tenantId!, name: b.name })}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-strong hover:underline">
                      <UserPlus className="h-3 w-3" /> {b.inviteStatus === 'none' ? 'Invite owner' : 'Manage invite'}
                    </button>
                  )}
                </div>
              )
            })()}

            <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
              <span className="text-xs text-muted">{rel(b.lastActivity)}</span>
              <button onClick={() => enter(b.tenantId)} disabled={entering === b.tenantId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink/90 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-ink active:scale-95 disabled:opacity-60">
                {entering === b.tenantId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Open <ArrowRight className="h-3.5 w-3.5" /></>}
              </button>
            </div>
          </div>
        ))}

        {/* Create card */}
        <button onClick={() => setWizardOpen(true)}
          className="flex min-h-[190px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline-strong bg-sunken/30 p-5 text-center transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-e1"><Plus className="h-5 w-5" /></span>
          <span className="text-sm font-semibold text-ink">Launch a new business</span>
          <span className="text-xs text-muted">Branded AI workforce in minutes</span>
        </button>
      </div>

      {filtered.length === 0 && businesses.length > 0 && (
        <p className="py-10 text-center text-sm text-muted">No businesses match “{q}”.</p>
      )}

      {/* Create wizard */}
      {wizardOpen && (
        <ProvisionClientWizard
          book={wizard.book} discount={wizard.discount} markup={wizard.markup}
          onClose={() => setWizardOpen(false)}
          onCreated={(created) => {
            setWizardOpen(false)
            router.refresh()
            if (created?.tenant_id) setSuccess({ tenant_id: created.tenant_id, business_name: created.business_name })
            else toast.success('Business created')
          }}
        />
      )}

      {/* Success moment */}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSuccess(null)}>
          <div className="sx-animate-in w-full max-w-sm rounded-3xl bg-surface p-8 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500 text-white shadow-e2">
              <PartyPopper className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">{success.business_name} is live</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-subtle">
              Its AI employee is on duty. Step inside to connect a channel and go live, or add another business.
            </p>
            <div className="mt-6 space-y-2">
              <button onClick={() => enter(success.tenant_id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white shadow-e2 transition-all hover:brightness-105 active:scale-[0.98]">
                <ArrowRight className="h-4 w-4" /> Enter {success.business_name}
              </button>
              <button onClick={() => { const s = success; setSuccess(null); setInvite({ tenantId: s.tenant_id, name: s.business_name }) }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-sm font-medium text-ink hover:bg-sunken">
                <UserPlus className="h-4 w-4" /> Invite the owner
              </button>
              <button onClick={() => setSuccess(null)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-subtle hover:text-ink">
                <CheckCircle2 className="h-4 w-4" /> Back to businesses
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite owner panel */}
      {invite && (
        <ClientInvitePanel tenantId={invite.tenantId} businessName={invite.name}
          onClose={() => setInvite(null)} onChanged={() => router.refresh()} />
      )}
    </div>
  )
}
