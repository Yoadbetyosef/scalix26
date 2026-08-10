'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { canSendForApproval, canSendToProduction, type OrderStage, type ApprovalType } from '@/lib/orders/stages'
import { SupplierPicker, type Supplier } from './supplier-picker'

interface Approval { id: string; approvalType: ApprovalType; recipientEmail: string; status: string; version: number; respondedAt: string | null; responseComment: string | null; estimatedCompletionDate: string | null; createdAt: string }
interface Att { id: string; fileName: string; visibility: 'internal' | 'public' }
const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'
// A response should read at a glance: approved is settled, anything else needs her.
const STATUS_TINT: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-800',
  changes_requested: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  sent: 'bg-blue-50 text-blue-700', opened: 'bg-blue-50 text-blue-700',
  revoked: 'bg-gray-100 text-gray-500', expired: 'bg-gray-100 text-gray-500',
}

export function ApprovalActions({ orderId, stage, prefill, orderSupplier }: {
  orderId: string; stage: OrderStage
  prefill: { factoryName: string | null; factoryEmail: string | null; customerName: string | null; customerEmail: string | null }
  /** The factory already recorded on this order, if any. Both dialogs open on it. */
  orderSupplier: Supplier | null
}) {
  const router = useRouter()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [atts, setAtts] = useState<Att[]>([])
  const [open, setOpen] = useState<ApprovalType | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  // Persistent, not a toast: "nobody was notified" is a fact she may need to act on minutes later.
  const [outcome, setOutcome] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [f, setF] = useState({ recipientName: '', recipientEmail: '', subject: '', message: '', deadline: '', sendCopyToSelf: true, internalNote: '', include: [] as string[] })
  // The factory a send is addressed to. A record, not a typed address — see supplier-picker.tsx.
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [prodOpen, setProdOpen] = useState(false)

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
    // Every shared file starts ticked. Sending the piece's reference photos is the normal case; leaving
    // one out should be the deliberate act, not remembering to include it.
    const shared = atts.filter((a) => a.visibility === 'public').map((a) => a.id)
    setSupplier(orderSupplier ?? null)
    setF({ recipientName: type === 'factory' ? prefill.factoryName ?? '' : prefill.customerName ?? '', recipientEmail: type === 'factory' ? prefill.factoryEmail ?? '' : prefill.customerEmail ?? '', subject: '', message: '', deadline: '', sendCopyToSelf: true, internalNote: '', include: shared })
    setOpen(type)
  }
  const send = async () => {
    if (!open) return
    setBusy(true); setErr(null)
    try {
      const body = { approvalType: open, supplierId: open === 'factory' ? supplier?.id ?? null : null, recipientName: f.recipientName || null, recipientEmail: open === 'factory' ? supplier?.email ?? '' : f.recipientEmail, subject: f.subject || null, message: f.message || null, deadline: f.deadline || null, attachmentIds: f.include, sendCopyToSelf: f.sendCopyToSelf, internalNote: f.internalNote || null }
      const r = await fetch(`/api/orders/${orderId}/approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to send')
      setOpen(null); router.refresh(); void load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const revoke = async (id: string) => { if (!confirm('Revoke this approval link? It will stop working.')) return; await fetch(`/api/orders/${orderId}/approvals/${id}`, { method: 'DELETE' }); router.refresh(); void load() }
  // Moving to Production emails the factory ONLY if a factory approval was sent and approved — that is the
  // only place an address exists today. So the confirm promises the stage move (always true) and never a
  // send, and the outcome afterwards names the address or says plainly that nobody was told.
  const toProduction = async (withSupplier: Supplier | null) => {
    setBusy(true); setErr(null); setOutcome(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/production`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierId: withSupplier?.id ?? null }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      setOutcome(j.notified
        ? { tone: 'ok', text: `Moved to Production. The factory was emailed at ${j.notified}.` }
        : j.reason === 'send_failed'
          ? { tone: 'warn', text: `Moved to Production, but the email to the factory did not go out${j.detail ? ` (${j.detail})` : ''}. Nobody has been told — contact them directly.` }
          : { tone: 'warn', text: 'Moved to Production. No email was sent — this order has no approved factory request, so there is no factory address on file. Nobody has been told.' })
      setProdOpen(false); router.refresh(); void load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const canFactory = canSendForApproval(stage, 'factory')
  const canCustomer = canSendForApproval(stage, 'customer')
  const canProd = canSendToProduction(stage)

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="flex flex-wrap gap-2">
        {canFactory && <button onClick={() => openModal('factory')} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">Send to Factory for Approval</button>}
        {canCustomer && <button onClick={() => openModal('customer')} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">Send to Customer for Approval</button>}
        {canProd && <button onClick={() => { setSupplier(orderSupplier ?? null); setErr(null); setProdOpen(true) }} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">Move to Production</button>}
      </div>

      {outcome && (
        <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${outcome.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          {outcome.text}
        </div>
      )}

      {approvals.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {approvals.map((ap) => (
            <li key={ap.id}>
              <div className="flex flex-wrap items-center gap-2 text-gray-600">
                {/* Once the piece is being made, a factory request is the work order — the factory is not
                    being asked to approve anything, they are holding the job. Calling it "factory" there
                    reads as an approval still outstanding. */}
                <span className="capitalize text-gray-900">{ap.approvalType === 'factory' && ['production', 'ready', 'delivered', 'completed'].includes(stage) ? 'work order' : ap.approvalType}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_TINT[ap.status] ?? 'bg-gray-100 text-gray-700'}`}>{ap.status.replace('_', ' ')} · v{ap.version}</span>
                <span className="text-xs text-gray-400">{ap.recipientEmail}</span>
                {ap.estimatedCompletionDate && <span className="text-xs text-gray-400">· est {ap.estimatedCompletionDate}</span>}
                {ap.respondedAt && <span className="text-xs text-gray-400">· {new Date(ap.respondedAt).toLocaleString()}</span>}
                {['sent', 'opened'].includes(ap.status) && <button onClick={() => revoke(ap.id)} className="ml-auto text-xs text-red-600 underline">Revoke</button>}
              </div>
              {/* What they actually said. It was being fetched and never shown, so a "changes requested"
                  gave no clue WHAT to change without going to find the notification email. */}
              {ap.responseComment && (
                <blockquote className={`mt-1 rounded-lg border-l-2 px-3 py-2 text-sm ${ap.status === 'approved' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
                  <span className="mr-1 text-xs font-medium capitalize opacity-70">{ap.approvalType} said:</span>
                  <span className="whitespace-pre-wrap">{ap.responseComment}</span>
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}

      {prodOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setProdOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Move to Production</h3>
            <p className="mt-1 text-sm text-gray-500">
              {stage === 'factory_approved' ? 'This skips customer approval. ' : ''}
              Choose the factory making this piece and they get the work order — the full specification and photographs, with no prices.
            </p>
            <div className="mt-3">
              <div className="text-xs text-gray-500">Factory</div>
              <SupplierPicker value={supplier} onChange={setSupplier} autoFocus />
            </div>
            {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={() => toProduction(supplier)} disabled={busy || !supplier?.email} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send work order & move'}</button>
              {/* Moving without telling anyone is legitimate — she may have phoned them. It is offered as
                  its own labelled choice so it can never be mistaken for a send. */}
              <button onClick={() => toProduction(null)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-40">Move without notifying anyone</button>
              <button onClick={() => setProdOpen(false)} className="ml-auto rounded-lg px-3 py-2 text-sm text-gray-500">Cancel</button>
            </div>
            {supplier && !supplier.email && <p className="mt-2 text-xs text-amber-700">{supplier.name} has no email address saved, so nothing can be sent to them.</p>}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Send to {open === 'factory' ? 'Factory' : 'Customer'} for Approval</h3>
            {open === 'factory' ? (
              <div className="mt-3">
                <div className="text-xs text-gray-500">Factory</div>
                <SupplierPicker value={supplier} onChange={setSupplier} autoFocus />
                {supplier && !supplier.email && <p className="mt-1 text-xs text-amber-700">{supplier.name} has no email address saved. Remove and re-add them with one to send.</p>}
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {open === 'customer' && <label className="block text-xs text-gray-500">Recipient name<input value={f.recipientName} onChange={(e) => setF((p) => ({ ...p, recipientName: e.target.value }))} className={inp} /></label>}
              {open === 'customer' && <label className="block text-xs text-gray-500">Recipient email<input value={f.recipientEmail} onChange={(e) => setF((p) => ({ ...p, recipientEmail: e.target.value }))} className={inp} /></label>}
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
            <div className="mt-4 flex gap-2"><button onClick={send} disabled={busy || (open === 'factory' ? !supplier?.email : !f.recipientEmail)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send approval request'}</button><button onClick={() => setOpen(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
