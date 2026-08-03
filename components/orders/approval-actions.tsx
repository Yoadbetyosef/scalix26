'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { canSendForApproval, canSendToProduction, type OrderStage, type ApprovalType } from '@/lib/orders/stages'

interface Approval { id: string; approvalType: ApprovalType; recipientEmail: string; status: string; version: number; respondedAt: string | null; responseComment: string | null; estimatedCompletionDate: string | null; createdAt: string }
interface Att { id: string; fileName: string; visibility: 'internal' | 'public' }
const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export function ApprovalActions({ orderId, stage, prefill }: { orderId: string; stage: OrderStage; prefill: { factoryName: string | null; factoryEmail: string | null; customerName: string | null; customerEmail: string | null } }) {
  const router = useRouter()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [atts, setAtts] = useState<Att[]>([])
  const [open, setOpen] = useState<ApprovalType | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ recipientName: '', recipientEmail: '', subject: '', message: '', deadline: '', sendCopyToSelf: true, internalNote: '', include: [] as string[] })

  const load = useCallback(async () => {
    const [ar, at] = await Promise.all([fetch(`/api/orders/${orderId}/approvals`), fetch(`/api/orders/${orderId}/attachments`)])
    if (ar.ok) setApprovals((await ar.json()).approvals)
    // Keep INTERNAL files in the list too. Filtering them out here was hiding the reason a factory
    // received no photos: a file defaults to internal, and nothing on this screen said so.
    if (at.ok) setAtts((await at.json()).attachments as Att[])
  }, [orderId])
  useEffect(() => { let active = true; (async () => { const [ar, at] = await Promise.all([fetch(`/api/orders/${orderId}/approvals`), fetch(`/api/orders/${orderId}/attachments`)]); if (!active) return; if (ar.ok) setApprovals((await ar.json()).approvals); if (at.ok) setAtts(((await at.json()).attachments as Att[]).filter((a) => a.visibility === 'public')) })(); return () => { active = false } }, [orderId])

  const openModal = (type: ApprovalType) => {
    setErr(null)
    setF({ recipientName: type === 'factory' ? prefill.factoryName ?? '' : prefill.customerName ?? '', recipientEmail: type === 'factory' ? prefill.factoryEmail ?? '' : prefill.customerEmail ?? '', subject: '', message: '', deadline: '', sendCopyToSelf: true, internalNote: '', include: [] })
    setOpen(type)
  }
  const send = async () => {
    if (!open) return
    setBusy(true); setErr(null)
    try {
      const body = { approvalType: open, recipientName: f.recipientName || null, recipientEmail: f.recipientEmail, subject: f.subject || null, message: f.message || null, deadline: f.deadline || null, attachmentIds: f.include, sendCopyToSelf: f.sendCopyToSelf, internalNote: f.internalNote || null }
      const r = await fetch(`/api/orders/${orderId}/approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to send')
      setOpen(null); router.refresh(); void load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const revoke = async (id: string) => { if (!confirm('Revoke this approval link? It will stop working.')) return; await fetch(`/api/orders/${orderId}/approvals/${id}`, { method: 'DELETE' }); router.refresh(); void load() }
  const toProduction = async () => { if (!confirm(stage === 'factory_approved' ? 'Send straight to production, skipping customer approval?' : 'Send this order to production?')) return; setBusy(true); try { const r = await fetch(`/api/orders/${orderId}/production`, { method: 'POST' }); if (!r.ok) throw new Error((await r.json()).error || 'Failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }

  const canFactory = canSendForApproval(stage, 'factory')
  const canCustomer = canSendForApproval(stage, 'customer')
  const canProd = canSendToProduction(stage)

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="flex flex-wrap gap-2">
        {canFactory && <button onClick={() => openModal('factory')} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">Send to Factory for Approval</button>}
        {canCustomer && <button onClick={() => openModal('customer')} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">Send to Customer for Approval</button>}
        {canProd && <button onClick={toProduction} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">Send to Production</button>}
      </div>

      {approvals.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {approvals.map((ap) => (
            <li key={ap.id} className="flex flex-wrap items-center gap-2 text-gray-600">
              <span className="capitalize text-gray-900">{ap.approvalType}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">{ap.status.replace('_', ' ')} · v{ap.version}</span>
              <span className="text-xs text-gray-400">{ap.recipientEmail}</span>
              {ap.estimatedCompletionDate && <span className="text-xs text-gray-400">· est {ap.estimatedCompletionDate}</span>}
              {['sent', 'opened'].includes(ap.status) && <button onClick={() => revoke(ap.id)} className="ml-auto text-xs text-red-600 underline">Revoke</button>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Send to {open === 'factory' ? 'Factory' : 'Customer'} for Approval</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-gray-500">Recipient name<input value={f.recipientName} onChange={(e) => setF((p) => ({ ...p, recipientName: e.target.value }))} className={inp} /></label>
              <label className="block text-xs text-gray-500">Recipient email<input value={f.recipientEmail} onChange={(e) => setF((p) => ({ ...p, recipientEmail: e.target.value }))} className={inp} /></label>
              <label className="block text-xs text-gray-500">Subject<input value={f.subject} onChange={(e) => setF((p) => ({ ...p, subject: e.target.value }))} className={inp} /></label>
              <label className="block text-xs text-gray-500">Approval deadline<input type="date" value={f.deadline} onChange={(e) => setF((p) => ({ ...p, deadline: e.target.value }))} className={inp} /></label>
            </div>
            <label className="mt-3 block text-xs text-gray-500">Message<textarea value={f.message} onChange={(e) => setF((p) => ({ ...p, message: e.target.value }))} rows={2} className={inp} /></label>
            {atts.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-gray-500">Files to send with this request</div>
                {atts.map((a) => (
                  a.visibility === 'public' ? (
                    <label key={a.id} className="mt-1 flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={f.include.includes(a.id)} onChange={(e) => setF((p) => ({ ...p, include: e.target.checked ? [...p.include, a.id] : p.include.filter((x) => x !== a.id) }))} />
                      {a.fileName}
                    </label>
                  ) : (
                    // Internal file: show it, explain why it can't be sent, and make it one click to fix.
                    <div key={a.id} className="mt-1 flex items-center gap-2 text-sm text-gray-400">
                      <input type="checkbox" disabled className="opacity-40" />
                      <span className="truncate">{a.fileName}</span>
                      <span className="shrink-0 text-xs">internal only</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(`/api/orders/${orderId}/attachments/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'public' }) })
                          setAtts((p) => p.map((x) => (x.id === a.id ? { ...x, visibility: 'public' } : x)))
                          setF((p) => ({ ...p, include: [...p.include, a.id] }))
                        }}
                        className="shrink-0 text-xs text-blue-600 underline"
                      >Share it</button>
                    </div>
                  )
                ))}
                {!atts.some((a) => a.visibility === 'public') && (
                  <p className="mt-1.5 text-xs text-amber-700">Uploaded files start as internal. Click <strong>Share it</strong> to include one with this request.</p>
                )}
              </div>
            )}
            <label className="mt-3 block text-xs text-gray-500">Internal note (never shared)<input value={f.internalNote} onChange={(e) => setF((p) => ({ ...p, internalNote: e.target.value }))} className={inp} /></label>
            <label className="mt-2 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.sendCopyToSelf} onChange={(e) => setF((p) => ({ ...p, sendCopyToSelf: e.target.checked }))} />Send a copy to me</label>
            {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
            <div className="mt-4 flex gap-2"><button onClick={send} disabled={busy || !f.recipientEmail} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send approval request'}</button><button onClick={() => setOpen(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
