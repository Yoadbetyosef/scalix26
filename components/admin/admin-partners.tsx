'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { PARTNER_MODULES, enabledPartnerModules, presetModulesFor, type PartnerModuleKey } from '@/lib/partner/modules'
import { PARTNER_TYPES, type PartnerType } from '@/lib/partner/roles'

interface Partner {
  id: string; company_name: string | null; slug: string; partner_type: string; billing_mode: string | null; default_commission_plan_id: string | null
  price_book_id: string | null; custom_wholesale_discount_pct: number | null; retail_markup_pct: number | null; agreement_notes: string | null
  status: string; tier: number; health_score: number | null; contact_email: string; enabled_modules: string[] | null; stats: { customers: number; pending: number; paid: number; client_count: number; providers_connected: number }
}
interface PlanLite { id: string; name: string; partner_id: string | null; model?: string }
interface PriceBookLite { id: string; name: string; billing_mode: string; is_active: boolean }
const BILLING_MODES: { key: string; label: string }[] = [
  { key: 'revenue_share', label: 'Revenue share' }, { key: 'reseller', label: 'Reseller' }, { key: 'white_label', label: 'White label' },
]

const money = (c: number) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

export function AdminPartners({ canWrite }: { canWrite: boolean }) {
  const [partners, setPartners] = useState<Partner[]>([])
  const [plans, setPlans] = useState<PlanLite[]>([])
  const [priceBooks, setPriceBooks] = useState<PriceBookLite[]>([])
  const [loading, setLoading] = useState(true)
  const [modulesFor, setModulesFor] = useState<Partner | null>(null)
  const [programFor, setProgramFor] = useState<Partner | null>(null)

  const load = useCallback(async () => {
    const [res, planRes, pbRes] = await Promise.all([fetch('/api/admin/partners'), fetch('/api/admin/commission-plans'), fetch('/api/admin/price-books')])
    const j = await res.json(); const pj = await planRes.json().catch(() => ({})); const bj = await pbRes.json().catch(() => ({}))
    setPartners(j.partners || []); setPlans(pj.plans || []); setPriceBooks(bj.books || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function saveModules(id: string, modules: PartnerModuleKey[]) {
    const res = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled_modules: modules }) })
    if (!res.ok) return toast.error('Failed')
    toast.success('Modules updated'); setModulesFor(null); load()
  }
  async function saveProgram(id: string, body: Record<string, unknown>) {
    const res = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    if (!res.ok) return toast.error('Failed')
    toast.success('Partner deal updated'); setProgramFor(null); load()
  }

  async function setStatus(id: string, status: string) {
    const res = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!res.ok) return toast.error('Failed'); load()
  }
  async function commission(partnerId: string, action: 'approve' | 'pay') {
    const res = await fetch('/api/admin/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerId, action }) })
    const j = await res.json()
    if (!res.ok) return toast.error(j.error || 'Failed')
    toast.success(action === 'pay' ? `Paid ${money(j.amount_cents)}` : 'Approved pending commissions'); load()
  }

  if (loading) return <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading…</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="px-3 py-2 font-medium">Partner</th><th className="px-3 py-2 font-medium">Type</th>
          <th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium text-right">Customers</th>
          <th className="px-3 py-2 font-medium text-right">Owed</th><th className="px-3 py-2 font-medium text-right">Paid</th>
          {canWrite && <th className="px-3 py-2 font-medium">Actions</th>}
        </tr></thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-b border-gray-100">
              <td className="px-3 py-2.5">
                <div className="font-medium text-gray-900">{p.company_name || p.slug}</div>
                <div className="text-xs text-gray-400">{p.contact_email}</div>
              </td>
              <td className="px-3 py-2.5 capitalize text-gray-600">{p.partner_type}</td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'active' ? 'bg-green-50 text-green-700' : p.status === 'suspended' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{p.status}</span>
              </td>
              <td className="px-3 py-2.5 text-right text-gray-700">{p.stats.customers}</td>
              <td className="px-3 py-2.5 text-right font-medium text-gray-900">{money(p.stats.pending)}</td>
              <td className="px-3 py-2.5 text-right text-gray-600">{money(p.stats.paid)}</td>
              {canWrite && (
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setProgramFor(p)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Deal</button>
                    <button onClick={() => setModulesFor(p)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Modules</button>
                    <button onClick={() => commission(p.id, 'approve')} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Approve</button>
                    <button onClick={() => commission(p.id, 'pay')} className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white">Pay out</button>
                    {p.status === 'active'
                      ? <button onClick={() => setStatus(p.id, 'suspended')} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Suspend</button>
                      : <button onClick={() => setStatus(p.id, 'active')} className="rounded border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50">Activate</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {partners.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No partners yet.</td></tr>}
        </tbody>
      </table>
      {modulesFor && <ModulesModal partner={modulesFor} onClose={() => setModulesFor(null)} onSave={saveModules} />}
      {programFor && <ProgramModal partner={programFor} plans={plans} priceBooks={priceBooks} onClose={() => setProgramFor(null)} onSave={saveProgram} />}
    </div>
  )
}

// Per-partner economics: partner type + billing mode + default commission plan. Reuses the existing
// engine — changing the type optionally re-applies its module preset; the resolved plan drives money.
function ProgramModal({ partner, plans, priceBooks, onClose, onSave }: { partner: Partner; plans: PlanLite[]; priceBooks: PriceBookLite[]; onClose: () => void; onSave: (id: string, body: Record<string, unknown>) => void }) {
  const [type, setType] = useState<string>(partner.partner_type)
  const [billing, setBilling] = useState<string>(partner.billing_mode || 'revenue_share')
  const [planId, setPlanId] = useState<string>(partner.default_commission_plan_id || '')
  const [priceBookId, setPriceBookId] = useState<string>(partner.price_book_id || '')
  const [discount, setDiscount] = useState<string>(partner.custom_wholesale_discount_pct != null ? String(partner.custom_wholesale_discount_pct) : '')
  const [markup, setMarkup] = useState<string>(partner.retail_markup_pct != null ? String(partner.retail_markup_pct) : '')
  const [notes, setNotes] = useState<string>(partner.agreement_notes || '')
  const [applyPreset, setApplyPreset] = useState(false)
  const sel = 'mt-1 h-9 w-full rounded border border-gray-300 px-2 text-sm'
  const isWholesale = billing === 'white_label' || billing === 'reseller'
  // Global plans + any plan already scoped to this partner.
  const planOptions = plans.filter((p) => !p.partner_id || p.partner_id === partner.id)
  const bookOptions = priceBooks.filter((b) => b.billing_mode === billing)

  // Non-blocking consistency warnings (admin can still save).
  const selModel = planOptions.find((p) => p.id === planId)?.model
  const warnings: string[] = []
  if (type === 'white_label' && billing !== 'white_label') warnings.push('White Label partners are usually on white_label billing mode.')
  if (billing === 'white_label' && type !== 'white_label') warnings.push('white_label billing is usually paired with the White Label partner type.')
  if (isWholesale && !priceBookId) warnings.push('White Label / Reseller partners should have a price book assigned.')
  if (isWholesale && selModel && !(selModel === 'wholesale' || selModel === 'white_label' || selModel === 'custom')) warnings.push('Commission plans are not the primary economics for white_label/reseller — assign a price book instead.')

  function save() {
    const body: Record<string, unknown> = {
      partner_type: type, billing_mode: billing, default_commission_plan_id: planId || null,
      price_book_id: isWholesale ? (priceBookId || null) : null,
      custom_wholesale_discount_pct: isWholesale ? discount : null,
      retail_markup_pct: isWholesale ? markup : null,
      agreement_notes: notes || null,
    }
    if (applyPreset) body.enabled_modules = presetModulesFor(type as PartnerType)
    onSave(partner.id, body)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 font-semibold text-gray-900">Partner deal — {partner.company_name || partner.slug}</div>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-500">Partner type
            <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
              {PARTNER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-500">Billing mode
            <select className={sel} value={billing} onChange={(e) => setBilling(e.target.value)}>
              {BILLING_MODES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-500">Default commission plan
            <select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Global default</option>
              {planOptions.map((p) => <option key={p.id} value={p.id}>{p.name}{p.partner_id ? ' (partner-specific)' : ''}</option>)}
            </select>
            {isWholesale && <span className="mt-0.5 block text-[11px] font-normal text-gray-400">Not the primary economics for white-label/reseller — assign a price book below.</span>}
          </label>

          {isWholesale && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">White Label / Reseller pricing</div>
              <div className="flex gap-4 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600"><span>Clients: <span className="font-medium text-gray-900">{partner.stats.client_count}</span></span><span>Infra connected: <span className="font-medium text-gray-900">{partner.stats.providers_connected}/4</span></span></div>
              <label className="block text-xs font-medium text-gray-500">Price book
                <select className={sel} value={priceBookId} onChange={(e) => setPriceBookId(e.target.value)}>
                  <option value="">None assigned</option>
                  {bookOptions.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}
                </select>
                {bookOptions.length === 0 && <span className="mt-0.5 block text-[11px] font-normal text-amber-600">No {billing} price books yet — create one under Programs.</span>}
              </label>
              <div className="flex gap-2">
                <label className="block flex-1 text-xs font-medium text-gray-500">Custom wholesale discount %
                  <input className={sel} inputMode="decimal" placeholder="optional" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </label>
                <label className="block flex-1 text-xs font-medium text-gray-500">Retail markup %
                  <input className={sel} inputMode="decimal" placeholder="optional" value={markup} onChange={(e) => setMarkup(e.target.value)} />
                </label>
              </div>
              <label className="block text-xs font-medium text-gray-500">Agreement notes
                <textarea className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" rows={2} placeholder="Internal notes on this partner's agreement" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 pt-1 text-sm text-gray-700">
            <input type="checkbox" checked={applyPreset} onChange={(e) => setApplyPreset(e.target.checked)} />
            Apply this type&apos;s module preset
          </label>
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <div className="mb-1 font-medium">Heads up — this setup may be inconsistent:</div>
              <ul className="list-disc space-y-0.5 pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-gray-400">A custom <span className="font-medium">Partner Deal</span> (under Programs) still overrides this default. Refunds/tiers are handled by the existing Economics Engine.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-gray-500">Cancel</button>
          <button onClick={save} className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white">Save changes</button>
        </div>
      </div>
    </div>
  )
}

function ModulesModal({ partner, onClose, onSave }: { partner: Partner; onClose: () => void; onSave: (id: string, m: PartnerModuleKey[]) => void }) {
  const [set, setSet] = useState<Set<string>>(new Set(enabledPartnerModules(partner)))
  const toggle = (k: string) => setSet((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-semibold text-gray-900">Modules — {partner.company_name || partner.slug}</div>
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
          <button onClick={() => setSet(new Set(PARTNER_MODULES.map((m) => m.key)))} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">All</button>
          <button onClick={() => setSet(new Set(presetModulesFor(partner.partner_type as PartnerType)))} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">Reset to preset</button>
          <button onClick={() => setSet(new Set())} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">None</button>
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {PARTNER_MODULES.map((m) => (
            <label key={m.key} className="flex items-center gap-2.5 rounded px-2 py-1.5 hover:bg-gray-50">
              <input type="checkbox" checked={set.has(m.key)} onChange={() => toggle(m.key)} />
              <span className="flex-1 text-sm text-gray-800">{m.label}</span>
              <span className="text-xs text-gray-400">{m.description}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-gray-500">Cancel</button>
          <button onClick={() => onSave(partner.id, [...set] as PartnerModuleKey[])} className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white">Save</button>
        </div>
      </div>
    </div>
  )
}
