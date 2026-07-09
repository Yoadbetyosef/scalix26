'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { PARTNER_MODULES, enabledPartnerModules, presetModulesFor, type PartnerModuleKey } from '@/lib/partner/modules'
import { PARTNER_TYPES, type PartnerType } from '@/lib/partner/roles'

interface Partner {
  id: string; company_name: string | null; slug: string; partner_type: string; billing_mode: string | null; default_commission_plan_id: string | null
  status: string; tier: number; health_score: number | null; contact_email: string; enabled_modules: string[] | null; stats: { customers: number; pending: number; paid: number }
}
interface PlanLite { id: string; name: string; partner_id: string | null }
const BILLING_MODES: { key: string; label: string }[] = [
  { key: 'revenue_share', label: 'Revenue share' }, { key: 'reseller', label: 'Reseller' }, { key: 'white_label', label: 'White label' },
]

const money = (c: number) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

export function AdminPartners({ canWrite }: { canWrite: boolean }) {
  const [partners, setPartners] = useState<Partner[]>([])
  const [plans, setPlans] = useState<PlanLite[]>([])
  const [loading, setLoading] = useState(true)
  const [modulesFor, setModulesFor] = useState<Partner | null>(null)
  const [programFor, setProgramFor] = useState<Partner | null>(null)

  const load = useCallback(async () => {
    const [res, planRes] = await Promise.all([fetch('/api/admin/partners'), fetch('/api/admin/commission-plans')])
    const j = await res.json(); const pj = await planRes.json().catch(() => ({}))
    setPartners(j.partners || []); setPlans(pj.plans || []); setLoading(false)
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
      {programFor && <ProgramModal partner={programFor} plans={plans} onClose={() => setProgramFor(null)} onSave={saveProgram} />}
    </div>
  )
}

// Per-partner economics: partner type + billing mode + default commission plan. Reuses the existing
// engine — changing the type optionally re-applies its module preset; the resolved plan drives money.
function ProgramModal({ partner, plans, onClose, onSave }: { partner: Partner; plans: PlanLite[]; onClose: () => void; onSave: (id: string, body: Record<string, unknown>) => void }) {
  const [type, setType] = useState<string>(partner.partner_type)
  const [billing, setBilling] = useState<string>(partner.billing_mode || 'revenue_share')
  const [planId, setPlanId] = useState<string>(partner.default_commission_plan_id || '')
  const [applyPreset, setApplyPreset] = useState(false)
  const sel = 'mt-1 h-9 w-full rounded border border-gray-300 px-2 text-sm'
  // Global plans + any plan already scoped to this partner.
  const planOptions = plans.filter((p) => !p.partner_id || p.partner_id === partner.id)

  function save() {
    const body: Record<string, unknown> = { partner_type: type, billing_mode: billing, default_commission_plan_id: planId || null }
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
          </label>
          <label className="flex items-center gap-2 pt-1 text-sm text-gray-700">
            <input type="checkbox" checked={applyPreset} onChange={(e) => setApplyPreset(e.target.checked)} />
            Apply this type&apos;s module preset
          </label>
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
