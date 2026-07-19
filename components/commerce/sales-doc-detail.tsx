'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, ArrowRightLeft, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCents, inputToCents } from '@/lib/core/money-format'
import type { DocType } from '@/lib/core/documents'
import { toast } from 'sonner'

interface Doc { id: string; number: string; status: string; currency: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; notes: string | null; source_document_type: string | null; created_at: string }
interface Line { id: string; description: string | null; quantity: number; unit_price_cents: number; discount_cents: number; tax_cents: number; line_total_cents: number }
interface PaySummary { total_cents?: number; paid_cents?: number; balance_cents?: number; status?: string }

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', sent: 'open', accepted: 'active', paid: 'active', partial: 'pending', unpaid: 'draft', refunded: 'closed', rejected: 'closed', void: 'closed' }
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'paid', 'void']
const CONVERT_TARGETS: Record<DocType, ('quote' | 'invoice')[]> = { estimate: ['quote', 'invoice'], quote: ['invoice'], invoice: [] }
const when = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export function SalesDocDetail({ type, id }: { type: DocType; id: string }) {
  const [doc, setDoc] = useState<Doc | null | 'notfound'>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [pay, setPay] = useState<PaySummary | null>(null)
  const [addingLine, setAddingLine] = useState(false)
  const [recording, setRecording] = useState(false)
  const [conv, setConv] = useState<{ target: string; targetId: string; number?: string; existed: boolean } | null>(null)

  const loadDoc = () => fetch(`/api/core/documents/${type}/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('404')))).then((d) => { setDoc(d.document); setLines(d.lines ?? []) }).catch(() => setDoc('notfound'))
  const loadPay = () => fetch(`/api/core/documents/${type}/${id}/payments`).then((r) => r.json()).then(setPay).catch(() => setPay(null))
  useEffect(() => { loadDoc(); loadPay() }, [type, id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(status: string) {
    const res = await fetch(`/api/core/documents/${type}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) })
    if (res.ok) { toast.success('Status updated.'); loadDoc() } else toast.error('Could not update status.')
  }

  async function convert(target: 'quote' | 'invoice') {
    const res = await fetch(`/api/core/documents/${type}/${id}/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: target, idempotencyKey: `conv:${id}:${target}` }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setConv({ target: d.target_type, targetId: d.target_id, number: d.number, existed: !!d.idempotent }); toast.success(d.idempotent ? `Already converted to ${target}.` : `Converted to ${target}.`) }
    else toast.error(d.error || 'Conversion failed.')
  }

  if (doc === 'notfound') return <div className="mx-auto max-w-3xl px-4 py-10 text-center text-sm text-muted">Document not found.</div>

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link href={`/commerce/${type}s`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> {type}s</Link>

      {!doc ? <Skeleton className="mb-6 h-16 w-full" /> : (
        <>
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-light tracking-tight text-ink">{doc.number}</h1>
              <p className="mt-0.5 text-xs text-muted">Created {when(doc.created_at)}{doc.source_document_type && <> · converted from {doc.source_document_type}</>}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[doc.status] ?? 'neutral'}>{doc.status}</Badge>
              <select value={doc.status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-input border border-hairline bg-white px-2 text-sm text-ink focus:border-ink/30 focus:outline-none">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </header>

          {conv && (
            <div className="mb-5 flex items-center justify-between gap-2 rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
              <span className="text-ink">{conv.existed ? 'Already converted' : 'Converted'} to {conv.target} {conv.number ?? ''}</span>
              <Link href={`/commerce/${conv.target}s/${conv.targetId}`} className="font-medium text-accent-strong hover:underline">Open →</Link>
            </div>
          )}

          {/* Lines */}
          <section className="mb-5 overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <h2 className="text-sm font-medium text-ink">Line items</h2>
              <Button size="sm" variant="ghost" onClick={() => setAddingLine(true)}><Plus className="h-4 w-4" /> Add line</Button>
            </div>
            {lines.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No line items yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2 font-medium">Description</th><th className="px-4 py-2 font-medium">Qty</th><th className="px-4 py-2 font-medium">Unit</th><th className="px-4 py-2 font-medium">Total</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink">{l.description || '—'}</td>
                        <td className="px-4 py-2 text-subtle">{l.quantity}</td>
                        <td className="px-4 py-2 text-subtle">{formatCents(l.unit_price_cents, doc.currency)}</td>
                        <td className="px-4 py-2 text-ink">{formatCents(l.line_total_cents, doc.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Totals */}
            <section className="rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
              <h2 className="mb-2 text-sm font-medium text-ink">Totals</h2>
              <Row label="Subtotal" value={formatCents(doc.subtotal_cents, doc.currency)} />
              <Row label="Discount" value={formatCents(doc.discount_cents, doc.currency)} />
              <Row label="Tax" value={formatCents(doc.tax_cents, doc.currency)} />
              <div className="mt-1 border-t border-hairline pt-1"><Row label="Total" value={formatCents(doc.total_cents, doc.currency)} strong /></div>
            </section>

            {/* Payments */}
            <section className="rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium text-ink">Payments</h2><Button size="sm" variant="ghost" onClick={() => setRecording(true)}><CreditCard className="h-4 w-4" /> Record</Button></div>
              <Row label="Paid" value={formatCents(pay?.paid_cents ?? 0, doc.currency)} />
              <Row label="Balance" value={formatCents(pay?.balance_cents ?? doc.total_cents, doc.currency)} />
              {pay?.status && <div className="mt-2"><Badge variant={STATUS_VARIANT[pay.status] ?? 'neutral'}>{pay.status}</Badge></div>}
            </section>
          </div>

          {/* Convert */}
          {CONVERT_TARGETS[type].length > 0 && (
            <section className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Convert:</span>
              {CONVERT_TARGETS[type].map((t) => <Button key={t} size="sm" variant="outline" onClick={() => convert(t)}><ArrowRightLeft className="h-4 w-4" /> To {t}</Button>)}
            </section>
          )}

          {doc.notes && <section className="mt-5 rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1"><h2 className="mb-1 text-sm font-medium text-ink">Notes</h2><p className="whitespace-pre-wrap text-subtle">{doc.notes}</p></section>}
        </>
      )}

      {addingLine && <LineForm type={type} id={id} onClose={() => setAddingLine(false)} onDone={() => { setAddingLine(false); loadDoc(); loadPay() }} />}
      {recording && <PaymentForm type={type} id={id} onClose={() => setRecording(false)} onDone={() => { setRecording(false); loadDoc(); loadPay() }} />}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between py-0.5"><span className="text-muted">{label}</span><span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</span></div>
}

function LineForm({ type, id, onClose, onDone }: { type: DocType; id: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    const qty = Number(quantity); const cents = inputToCents(price)
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (cents == null || Number.isNaN(cents)) { toast.error('Enter a valid unit price.'); return }
    setSaving(true)
    const res = await fetch(`/api/core/documents/${type}/${id}/lines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: description.trim() || null, quantity: qty, unit_price_cents: cents }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success('Line added.'); onDone() } else toast.error(d.error || 'Could not add the line.')
  }
  return (
    <Drawer open onClose={onClose} title="Add line item" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>Add</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item description" maxLength={1000} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Quantity</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0" step="1" inputMode="decimal" /></div>
          <div className="space-y-1.5"><Label>Unit price (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
        </div>
      </div>
    </Drawer>
  )
}

function PaymentForm({ type, id, onClose, onDone }: { type: DocType; id: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('deposit')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    const cents = inputToCents(amount)
    if (cents == null || Number.isNaN(cents) || cents <= 0) { toast.error('Enter a valid amount.'); return }
    setSaving(true)
    const res = await fetch(`/api/core/documents/${type}/${id}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, amountCents: cents }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success('Payment recorded.'); onDone() } else toast.error(d.error || 'Could not record the payment.')
  }
  return (
    <Drawer open onClose={onClose} title="Record payment" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>Record</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Kind</Label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
            <option value="deposit">Deposit</option><option value="charge">Charge</option><option value="refund">Refund</option><option value="adjustment">Adjustment</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label>Amount (USD)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
      </div>
    </Drawer>
  )
}
