'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { money } from '@/components/partner/ui'
import { WholesaleInfrastructure } from '@/components/partner/wholesale-infrastructure'
import { effectiveItemPricing, type PriceBook } from '@/lib/partner/wholesale'
import { Building2, Plug, Tag, Rocket, ArrowRight, ArrowLeft, Check, Loader2 } from 'lucide-react'

const inp = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const lbl = 'mb-1 block text-xs font-medium text-subtle'
const STEPS = [{ n: 1, label: 'Business', icon: Building2 }, { n: 2, label: 'Infrastructure', icon: Plug }, { n: 3, label: 'Pricing', icon: Tag }, { n: 4, label: 'Launch', icon: Rocket }]

export function WholesaleSetupWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [book, setBook] = useState<PriceBook | null>(null)
  const [overrides, setOverrides] = useState<{ discount: number | null; markup: number | null }>({ discount: null, markup: null })
  const [biz, setBiz] = useState({ company_name: '', logo_url: '', primary_color: '#5B6CF0', support_email: '', support_phone: '', website: '' })
  const [retail, setRetail] = useState<Record<string, string>>({})
  const [connected, setConnected] = useState(0)
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    fetch('/api/partner/setup').then((r) => r.json()).then((j) => {
      setBiz((b) => ({ ...b, ...(j.wl_business || {}), company_name: j.wl_business?.company_name || j.company_name || '' }))
      const rd = j.wl_retail_defaults || {}
      setRetail(Object.fromEntries(Object.entries(rd).map(([k, v]) => [k, String(Number(v) / 100)])))
    }).catch(() => {})
    fetch('/api/partner/clients?page=1').then((r) => r.json()).then((j) => { setBook(j.priceBook || null); setOverrides(j.overrides || { discount: null, markup: null }) }).catch(() => {})
  }, [])

  async function launch() {
    setLaunching(true)
    const retail_defaults: Record<string, number> = {}
    for (const [k, v] of Object.entries(retail)) if (v) retail_defaults[k] = Math.round(Number(v) * 100)
    const r = await fetch('/api/partner/setup', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wl_business: biz, wl_retail_defaults: retail_defaults, wl_setup_complete: true }) })
    setLaunching(false)
    if (!r.ok) return toast.error('Could not launch')
    toast.success('Your AI company is live!'); router.push('/partner'); router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Stepper */}
      <div className="mb-6 flex items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center">
            <div className={`flex items-center gap-2 ${step >= s.n ? 'text-ink' : 'text-muted'}`}>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${step > s.n ? 'bg-green-100 text-green-700' : step === s.n ? 'bg-ink text-white' : 'bg-sunken text-muted'}`}>{step > s.n ? <Check className="h-4 w-4" /> : s.n}</span>
              <span className="hidden text-sm font-medium sm:block">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`mx-2 h-0.5 flex-1 ${step > s.n ? 'bg-green-300' : 'bg-hairline'}`} />}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-e1 sm:p-6">
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">Your business</h2>
            <p className="text-sm text-subtle">This is how your AI company presents to your clients.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={lbl}>Company name</label><input className={inp} value={biz.company_name} onChange={(e) => setBiz({ ...biz, company_name: e.target.value })} /></div>
              <div><label className={lbl}>Logo URL</label><input className={inp} value={biz.logo_url} onChange={(e) => setBiz({ ...biz, logo_url: e.target.value })} placeholder="https://…" /></div>
              <div><label className={lbl}>Primary color</label><input type="color" value={biz.primary_color} onChange={(e) => setBiz({ ...biz, primary_color: e.target.value })} className="h-10 w-full rounded-lg border border-hairline-strong" /></div>
              <div><label className={lbl}>Support email</label><input className={inp} value={biz.support_email} onChange={(e) => setBiz({ ...biz, support_email: e.target.value })} /></div>
              <div><label className={lbl}>Support phone</label><input className={inp} value={biz.support_phone} onChange={(e) => setBiz({ ...biz, support_phone: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Website</label><input className={inp} value={biz.website} onChange={(e) => setBiz({ ...biz, website: e.target.value })} placeholder="https://…" /></div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-ink">Connect your infrastructure</h2>
            <p className="mb-4 text-sm text-subtle">You bring your own accounts — Scalix runs your clients on them and never bills these providers. Connect what you have now; you can add the rest anytime from Infrastructure.</p>
            <WholesaleInfrastructure onChange={setConnected} />
            <p className="mt-3 text-xs text-muted">{connected} provider{connected === 1 ? '' : 's'} connected. You can launch and finish connecting later.</p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">Your retail pricing</h2>
            <p className="text-sm text-subtle">You choose what your clients pay. Your wholesale cost comes from your assigned price book.</p>
            {!book || book.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center text-sm text-subtle">No price book assigned yet — your pricing is set by your Scalix26 agreement. You can still launch and set client prices individually.</div>
            ) : (
              <div className="space-y-2">
                {book.items.map((it) => {
                  const p = effectiveItemPricing(it, { customWholesaleDiscountPct: overrides.discount, retailMarkupPct: overrides.markup })
                  const retailCents = retail[it.plan_code] ? Math.round(Number(retail[it.plan_code]) * 100) : p.retail_cents
                  return (
                    <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-canvas p-3">
                      <div className="min-w-[100px] font-medium text-ink">{it.plan_name}</div>
                      <div className="text-xs text-muted">Wholesale <span className="text-subtle">{money(p.wholesale_cents)}/mo</span></div>
                      <label className="ml-auto flex items-center gap-2 text-xs text-subtle">Your retail $<input className="h-9 w-24 rounded-lg border border-hairline-strong px-2 text-sm" inputMode="decimal" value={retail[it.plan_code] ?? String(p.retail_cents / 100)} onChange={(e) => setRetail((v) => ({ ...v, [it.plan_code]: e.target.value }))} /></label>
                      <div className="text-xs font-medium text-green-700">+{money(retailCents - p.wholesale_cents)}/mo</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {step === 4 && (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Rocket className="h-6 w-6" /></div>
            <h2 className="text-lg font-semibold text-ink">Launch your AI company</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-subtle">{biz.company_name || 'Your business'} is ready. You&apos;ll manage clients, pricing, and infrastructure from your dashboard. You can refine everything anytime.</p>
            <div className="mx-auto mt-4 grid max-w-sm grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-hairline bg-canvas p-2"><div className="font-semibold text-ink">{connected}</div><div className="text-muted">Providers</div></div>
              <div className="rounded-lg border border-hairline bg-canvas p-2"><div className="font-semibold text-ink">{book?.items.length || 0}</div><div className="text-muted">Plans</div></div>
              <div className="rounded-lg border border-hairline bg-canvas p-2"><div className="font-semibold text-ink">Ready</div><div className="text-muted">Status</div></div>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink disabled:opacity-40"><ArrowLeft className="h-4 w-4" /> Back</button>
          {step < 4 ? (
            <button onClick={() => setStep((s) => s + 1)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-5 text-sm font-medium text-white">Continue <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={launch} disabled={launching} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-5 text-sm font-medium text-white disabled:opacity-60">{launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Launch My AI Company</button>
          )}
        </div>
      </div>
    </div>
  )
}
