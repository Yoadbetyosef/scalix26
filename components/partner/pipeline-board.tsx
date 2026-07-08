'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { PIPELINE_COLUMNS, STAGE_LABEL, STAGE_COLOR, CRM_STAGES, type CrmStage } from '@/lib/partner/crm'
import { Plus, Upload, X } from 'lucide-react'
import { LeadDrawer } from '@/components/partner/lead-drawer'

interface Lead { id: string; business_name: string; contact_name: string | null; email: string | null; phone: string | null; industry: string | null; stage: CrmStage; estimated_mrr_cents: number | null; assigned_to: string | null; updated_at: string }

export function PipelineBoard({ canEdit }: { canEdit: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [openLead, setOpenLead] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/crm/leads'); const j = await res.json()
    setLeads(j.leads || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function move(id: string, stage: CrmStage) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, stage } : l)))
    const res = await fetch('/api/partner/crm/leads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, stage }) })
    if (!res.ok) { toast.error('Failed to move'); load() }
  }

  if (loading) return <div className="rounded-xl border border-hairline bg-surface p-10 text-center text-sm text-muted">Loading…</div>

  return (
    <div>
      {canEdit && (
        <div className="mb-4 flex gap-2">
          <button onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white"><Plus className="h-4 w-4" /> New lead</button>
          <button onClick={() => setImporting(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-subtle hover:text-ink"><Upload className="h-4 w-4" /> Import CSV</button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map((stage) => {
          const items = leads.filter((l) => l.stage === stage)
          return (
            <div key={stage} className="w-64 flex-shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{STAGE_LABEL[stage]}</span>
                <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <button key={l.id} onClick={() => setOpenLead(l.id)} className="w-full rounded-xl border border-hairline bg-surface p-3 text-left shadow-e1 transition-shadow hover:shadow-e2">
                    <div className="text-sm font-medium text-ink">{l.business_name}</div>
                    {l.contact_name && <div className="text-xs text-muted">{l.contact_name}</div>}
                    <div className="mt-1 flex items-center justify-between">
                      {l.estimated_mrr_cents ? <span className="text-xs text-subtle">${(l.estimated_mrr_cents / 100).toFixed(0)}/mo</span> : <span />}
                      {canEdit && (
                        <select value={l.stage} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); move(l.id, e.target.value as CrmStage) }}
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize outline-none ${STAGE_COLOR[l.stage]}`}>
                          {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      )}
                    </div>
                  </button>
                ))}
                {items.length === 0 && <div className="rounded-xl border border-dashed border-hairline-strong px-2 py-6 text-center text-xs text-muted">Empty</div>}
              </div>
            </div>
          )
        })}
      </div>

      {adding && <NewLeadModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load() }} />}
      {openLead && <LeadDrawer leadId={openLead} canEdit={canEdit} onClose={() => setOpenLead(null)} onChanged={load} />}
    </div>
  )
}

function NewLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ business_name: '', contact_name: '', email: '', phone: '', industry: '', estimated_mrr: '' })
  const [busy, setBusy] = useState(false)
  const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const res = await fetch('/api/partner/crm/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, estimated_mrr_cents: f.estimated_mrr ? Math.round(Number(f.estimated_mrr) * 100) : null }) })
    setBusy(false)
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Lead added'); onSaved()
  }
  return (
    <Modal title="New lead" onClose={onClose}>
      <form onSubmit={save} className="space-y-2">
        <input required placeholder="Business name *" className={input} value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Contact name" className={input} value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} />
          <input placeholder="Industry" className={input} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} />
          <input placeholder="Email" className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input placeholder="Phone" className={input} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input placeholder="Est. MRR ($/mo)" type="number" className={input} value={f.estimated_mrr} onChange={(e) => setF({ ...f, estimated_mrr: e.target.value })} />
        </div>
        <button disabled={busy} className="h-10 w-full rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Add lead'}</button>
      </form>
    </Modal>
  )
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true)
    const csv = await file.text()
    const res = await fetch('/api/partner/crm/leads/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Import failed')
    toast.success(`Imported ${j.imported} leads`); onDone()
  }
  return (
    <Modal title="Import leads from CSV" onClose={onClose}>
      <p className="mb-3 text-sm text-subtle">CSV with a <b>business name</b> column (plus optional contact, email, phone, website, industry).</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} className="text-sm" />
      {busy && <p className="mt-2 text-xs text-muted">Importing…</p>}
    </Modal>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
