'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, StickyNote, Phone, Mail, MessageSquare, CheckSquare, ArrowRightLeft } from 'lucide-react'
import { STAGE_LABEL, type CrmStage } from '@/lib/partner/crm'

interface Lead { id: string; business_name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; industry: string | null; stage: CrmStage; notes: string | null; estimated_mrr_cents: number | null }
interface Activity { id: string; kind: string; body: string | null; created_at: string }

const KIND_ICON: Record<string, typeof StickyNote> = { note: StickyNote, call: Phone, email: Mail, sms: MessageSquare, task: CheckSquare, stage_change: ArrowRightLeft, demo_sent: ArrowRightLeft }

export function LeadDrawer({ leadId, canEdit, onClose, onChanged }: { leadId: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('note')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/partner/crm/leads/${leadId}`); const j = await res.json()
    setLead(j.lead); setActivities(j.activities || [])
  }, [leadId])
  useEffect(() => { load() }, [load])

  async function addActivity(e: React.FormEvent) {
    e.preventDefault(); if (!note.trim()) return
    setBusy(true)
    const res = await fetch('/api/partner/crm/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, kind, body: note }) })
    setBusy(false)
    if (!res.ok) return toast.error('Failed')
    setNote(''); load(); onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h3 className="font-semibold text-ink">{lead?.business_name || 'Lead'}</h3>
          <button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
        </div>
        {lead && (
          <div className="p-5">
            <div className="mb-4 space-y-1 text-sm">
              {lead.contact_name && <div><span className="text-muted">Contact:</span> <span className="text-ink">{lead.contact_name}</span></div>}
              {lead.email && <div><span className="text-muted">Email:</span> <a href={`mailto:${lead.email}`} className="text-accent-strong">{lead.email}</a></div>}
              {lead.phone && <div><span className="text-muted">Phone:</span> <a href={`tel:${lead.phone}`} className="text-accent-strong">{lead.phone}</a></div>}
              {lead.website && <div><span className="text-muted">Website:</span> <a href={lead.website} target="_blank" rel="noreferrer" className="text-accent-strong">{lead.website}</a></div>}
              <div><span className="text-muted">Stage:</span> <span className="text-ink">{STAGE_LABEL[lead.stage]}</span></div>
              {lead.estimated_mrr_cents ? <div><span className="text-muted">Est. MRR:</span> <span className="text-ink">${(lead.estimated_mrr_cents / 100).toFixed(0)}/mo</span></div> : null}
            </div>

            {canEdit && (
              <form onSubmit={addActivity} className="mb-4">
                <div className="mb-2 flex gap-1">
                  {['note', 'call', 'email', 'sms', 'task'].map((k) => (
                    <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-lg px-2 py-1 text-xs capitalize ${kind === k ? 'bg-ink text-white' : 'bg-sunken text-subtle'}`}>{k}</button>
                  ))}
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a note, call, or task…" rows={2}
                  className="w-full rounded-lg border border-hairline-strong p-2.5 text-sm outline-none focus:border-accent" />
                <button disabled={busy} className="mt-2 h-9 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">Add</button>
              </form>
            )}

            <div className="border-t border-hairline pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</div>
              <div className="space-y-3">
                {activities.length === 0 && <div className="text-sm text-muted">No activity yet.</div>}
                {activities.map((a) => {
                  const Icon = KIND_ICON[a.kind] || StickyNote
                  return (
                    <div key={a.id} className="flex gap-2.5">
                      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sunken text-subtle"><Icon className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">{a.body}</div>
                        <div className="text-xs text-muted">{new Date(a.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
