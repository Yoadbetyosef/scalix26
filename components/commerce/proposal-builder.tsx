'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, Send, Copy, Eye, ArrowRightLeft, User, Check, Loader2, CircleAlert, Archive, Lock, Link2, ImageOff, Upload, ExternalLink } from 'lucide-react'
import { CustomerPicker } from '@/components/commerce/customer-picker'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCents, inputToCents, centsToInput } from '@/lib/core/money-format'
import { AVAILABILITY } from '@/components/commerce/product-inventory'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', ready: 'pending', sent: 'open', viewed: 'open', accepted: 'active', declined: 'closed', expired: 'closed', converted: 'resolved' }
const EVENT_LABEL: Record<string, string> = { created: 'Created', customer_changed: 'Customer changed', item_added: 'Item added', item_edited: 'Item edited', item_removed: 'Item removed', previewed: 'Previewed internally', email_attempted: 'Email send attempted', email_sent: 'Email sent', email_failed: 'Email failed', viewed: 'Viewed by customer', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', updated_after_send: 'Updated after send', converted_invoice: 'Converted to invoice', converted_order: 'Converted to order', archived: 'Archived', duplicated: 'Duplicated', template_changed: 'Template changed' }
const TEMPLATES = [{ v: 'clean', l: 'Clean' }, { v: 'visual', l: 'Visual' }, { v: 'minimal', l: 'Minimal' }]

interface Doc { id: string; number: string; status: string; currency: string; subtotal_cents: number; discount_cents: number; overall_discount_cents: number; tax_cents: number; total_cents: number; contact_id: string | null; company_id: string | null; expires_at: string | null; customer_notes: string | null; internal_notes: string | null; terms: string | null; template: string; public_token: string | null; last_emailed_to: string | null; sent_at: string | null; first_viewed_at: string | null; last_viewed_at: string | null; accepted_at: string | null; accepted_by_name: string | null; declined_at: string | null; updated_after_send_at: string | null; converted_invoice_id: string | null; converted_order_id: string | null }
interface Line { id: string; description: string | null; quantity: number; unit_price_cents: number; discount_cents: number; line_total_cents: number; product_id: string | null; component_id: string | null; variant_id: string | null; custom_attributes: Record<string, unknown> }
interface Activity { id: string; event_type: string; message: string | null; created_at: string }
interface Full { type: 'proposal' | 'estimate' | 'quote'; editable: boolean; legacyReadOnly: boolean; lockReason: string | null; document: Doc; lines: Line[]; contact: { id: string; name: string | null; phone: string | null; email: string | null } | null; company: { id: string; name: string } | null; activity: Activity[] }
const when = (iso: string | null) => { if (!iso) return null; try { return new Date(iso).toLocaleString() } catch { return iso } }
const lineImg = (l: Line): string | null => { const a = l.custom_attributes ?? {}; if (a.hide_image === true) return null; return (a.proposal_image_url as string) || ((a.snapshot as { image_url?: string })?.image_url) || (a.image_url as string) || null }

export function ProposalBuilder({ id }: { id: string }) {
  const router = useRouter()
  const [data, setData] = useState<Full | null | 'notfound'>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [addingLine, setAddingLine] = useState(false)
  const [editLine, setEditLine] = useState<Line | null>(null)
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [sending, setSending] = useState(false)
  const [editUnlocked, setEditUnlocked] = useState(false)
  const [conv, setConv] = useState<{ target: string; id: string; number?: string; existed: boolean } | null>(null)

  const load = useCallback(() => fetch(`/api/core/proposals/${id}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setData('notfound')), [id])
  useEffect(() => { load() }, [load])

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    setSave('saving')
    const res = await fetch(`/api/core/proposals/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })
    if (res.ok) { setSave('saved'); load(); setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 1500) }
    else { setSave('error'); const d = await res.json().catch(() => ({})); if (res.status === 409) toast.error('This proposal is locked. Duplicate it to make changes.'); else toast.error(d.error || 'Could not save.') }
  }, [id, load])

  async function setCustomer(v: { contactId: string | null; companyId: string | null }) { await patch({ contactId: v.contactId, companyId: v.companyId }); setPickingCustomer(false) }
  async function removeLine(lineId: string) { const res = await fetch(`/api/core/proposals/${id}/lines/${lineId}`, { method: 'DELETE' }); if (res.ok) load(); else toast.error('Could not remove the line.') }
  async function duplicate() {
    const res = await fetch(`/api/core/proposals/${id}/duplicate`, { method: 'POST' }); const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { toast.success('Proposal duplicated.'); router.push(`/commerce/proposals/${d.id}`) } else toast.error(d.error || 'Could not duplicate.')
  }
  async function archive() { if (!confirm('Archive this proposal? It will be marked declined and hidden from active work.')) return; await patch({ status: 'declined' }); toast.success('Proposal archived.') }
  async function convert(target: 'invoice' | 'order') {
    const res = await fetch(`/api/core/proposals/${id}/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setConv({ target, id: d.invoiceId || d.orderId, number: d.number || d.orderNumber, existed: !!d.idempotent }); toast.success(d.idempotent ? `Already converted to ${target}.` : `Converted to ${target}.`); load() }
    else toast.error(d.error || 'Conversion failed.')
  }
  function openPreview() { window.open(`/commerce/proposals/${id}/preview`, '_blank', 'noopener') }

  if (data === 'notfound') return <div className="mx-auto max-w-3xl px-4 py-10 text-center text-sm text-muted">Proposal not found.</div>
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-6"><Skeleton className="h-16 w-full" /></div>

  const { document: doc, lines, contact, company } = data
  const status = doc.status
  const locked = !data.editable                       // accepted/converted/legacy → no edits
  const sentLike = status === 'sent' || status === 'viewed'
  const canEditNow = data.editable && (!sentLike || editUnlocked)
  const publicUrl = doc.public_token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/proposals/${doc.public_token}` : null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link href="/commerce/proposals" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> Proposals</Link>

      {data.legacyReadOnly && <div className="mb-4 rounded-card border border-hairline bg-sunken px-4 py-2.5 text-sm text-subtle">This is a legacy {data.type} — shown read-only for history.</div>}

      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-light tracking-tight text-ink">{doc.number}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted"><Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>{status}</Badge><SaveIndicator state={save} /></div>
        </div>
        {!data.legacyReadOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={openPreview}><Eye className="h-4 w-4" /> Preview</Button>
            <Button size="sm" variant="outline" onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate</Button>
            <Button size="sm" onClick={() => setSending(true)} disabled={locked} title={locked ? (data.lockReason ?? 'Locked') : 'Send to the customer'}><Send className="h-4 w-4" /> Send</Button>
            <Button size="sm" variant="ghost" onClick={archive} disabled={status === 'converted'} title={status === 'converted' ? 'Converted proposals cannot be archived' : 'Archive'}><Archive className="h-4 w-4" /> Archive</Button>
          </div>
        )}
      </header>

      {locked && data.lockReason && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-card border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" /> {data.lockReason}</span>
          <Button size="sm" variant="outline" onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate to a new draft</Button>
        </div>
      )}
      {sentLike && !editUnlocked && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-card border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>This proposal was <strong>{status}</strong>{status === 'viewed' ? ' — the customer may have already seen this version.' : '.'} Editing changes what a returning customer sees.</span>
          <Button size="sm" variant="outline" onClick={() => setEditUnlocked(true)}>Update proposal</Button>
        </div>
      )}
      {sentLike && editUnlocked && doc.updated_after_send_at && <div className="mb-5 rounded-card border border-hairline bg-sunken px-4 py-2 text-xs text-muted">Edited after sending. Re-send to give the customer the updated version.</div>}

      {conv && (
        <div className="mb-5 flex items-center justify-between gap-2 rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="text-ink">{conv.existed ? 'Already converted' : 'Converted'} to {conv.target} {conv.number ?? ''}</span>
          <Link href={conv.target === 'order' ? `/orders/${conv.id}` : `/commerce/invoices/${conv.id}`} className="font-medium text-accent-strong hover:underline">Open →</Link>
        </div>
      )}

      {publicUrl && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-surface px-4 py-2.5 text-sm shadow-e1">
          <span className="inline-flex min-w-0 items-center gap-2 text-muted"><Link2 className="h-4 w-4 shrink-0" /><span className="truncate text-xs text-subtle">{publicUrl}</span></span>
          <span className="flex shrink-0 gap-2">
            <button onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success('Link copied.') }} className="text-xs font-medium text-accent-strong hover:underline">Copy</button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open customer page</a>
          </span>
        </div>
      )}

      <section className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-card border border-hairline bg-surface p-3 shadow-e1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-strong"><User className="h-4 w-4" /></span>
            {contact ? <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{contact.name || 'Unknown'}{company && <span className="font-normal text-muted"> · {company.name}</span>}</p><p className="truncate text-xs text-muted">{[contact.phone, contact.email].filter(Boolean).join(' · ') || '—'}</p></div> : <p className="text-sm text-muted">No customer</p>}
          </div>
          {!locked && <div className="flex shrink-0 gap-1"><Button size="sm" variant="outline" onClick={() => setPickingCustomer(true)}>{contact ? 'Change' : 'Select'}</Button><Button size="sm" variant="ghost" onClick={() => setAddingCustomer(true)}><Plus className="h-4 w-4" /> New</Button></div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card border border-hairline bg-surface p-3 shadow-e1">
            <Label className="text-xs text-muted">Expiration</Label>
            <Input type="date" defaultValue={doc.expires_at ? String(doc.expires_at).slice(0, 10) : ''} disabled={!canEditNow} onChange={(e) => patch({ expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })} className="mt-1" />
          </div>
          <div className="rounded-card border border-hairline bg-surface p-3 shadow-e1">
            <Label className="text-xs text-muted">Template</Label>
            <select value={doc.template} disabled={!canEditNow} onChange={(e) => patch({ template: e.target.value })} className="mt-1 h-11 w-full rounded-input border border-hairline bg-white px-2 text-sm text-ink disabled:opacity-50 focus:border-ink/30 focus:outline-none">
              {TEMPLATES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h2 className="text-sm font-medium text-ink">Line items</h2>
          {canEditNow && <Button size="sm" variant="ghost" onClick={() => setAddingLine(true)}><Plus className="h-4 w-4" /> Add from catalog</Button>}
        </div>
        {lines.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No items yet. Add products, components or variants from your catalog.</p> : (
          <ul className="divide-y divide-hairline">
            {lines.map((l) => { const img = lineImg(l); const a = l.custom_attributes ?? {}; const snap = (a.snapshot as { sku?: string; component_name?: string; variant_name?: string }) ?? {}
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  {img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-hairline object-cover" />
                    : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><ImageOff className="h-4 w-4" /></span>}
                  <button disabled={!canEditNow} onClick={() => setEditLine(l)} className="min-w-0 flex-1 text-left disabled:cursor-default">
                    <p className="truncate text-sm text-ink">{l.description || '—'}</p>
                    <p className="truncate text-xs text-muted">{[snap.sku, l.component_id ? (snap.component_name || 'component') : null, l.variant_id ? (snap.variant_name || 'variant') : null, `${l.quantity} × ${formatCents(l.unit_price_cents, doc.currency)}`].filter(Boolean).join(' · ')}</p>
                  </button>
                  <span className="shrink-0 text-sm text-ink">{formatCents(l.line_total_cents, doc.currency)}</span>
                  {canEditNow && <button onClick={() => removeLine(l.id)} className="shrink-0 text-subtle hover:text-danger" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mb-5 rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
        <h2 className="mb-2 text-sm font-medium text-ink">Totals</h2>
        <Row label="Subtotal" value={formatCents(doc.subtotal_cents, doc.currency)} />
        <div className="flex items-center justify-between py-1"><span className="text-muted">Overall discount</span><Input type="number" min="0" step="0.01" disabled={!canEditNow} defaultValue={centsToInput(doc.overall_discount_cents)} onBlur={(e) => { const c = inputToCents(e.target.value); if (c != null) patch({ overallDiscountCents: c }) }} className="h-8 w-28 text-right" /></div>
        <div className="flex items-center justify-between py-1"><span className="text-muted">Tax</span><Input type="number" min="0" step="0.01" disabled={!canEditNow} defaultValue={centsToInput(doc.tax_cents)} onBlur={(e) => { const c = inputToCents(e.target.value); if (c != null) patch({ taxCents: c }) }} className="h-8 w-28 text-right" /></div>
        <div className="mt-1 border-t border-hairline pt-1"><Row label="Total" value={formatCents(doc.total_cents, doc.currency)} strong /></div>
      </section>

      {!locked ? (
        <section className="mb-5 grid gap-4 sm:grid-cols-2">
          <NoteField label="Customer-facing intro" hint="Shown on the proposal" defaultValue={doc.customer_notes} disabled={!canEditNow} onSave={(v) => patch({ customerNotes: v })} />
          <NoteField label="Internal notes" hint="Never shown to the customer" defaultValue={doc.internal_notes} disabled={!canEditNow} onSave={(v) => patch({ internalNotes: v })} />
          <div className="sm:col-span-2"><NoteField label="Terms & conditions" hint="Shown on the proposal" defaultValue={doc.terms} disabled={!canEditNow} onSave={(v) => patch({ terms: v })} rows={3} /></div>
        </section>
      ) : (
        <section className="mb-5 space-y-3">
          {doc.customer_notes && <ReadNote label="Customer intro" value={doc.customer_notes} />}
          {doc.terms && <ReadNote label="Terms" value={doc.terms} />}
        </section>
      )}

      {!data.legacyReadOnly && status !== 'converted' && (
        <section className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Convert{status !== 'accepted' ? ' (accept first for the standard flow)' : ''}:</span>
          <Button size="sm" variant="outline" onClick={() => convert('invoice')}><ArrowRightLeft className="h-4 w-4" /> To invoice</Button>
          <Button size="sm" variant="outline" onClick={() => convert('order')}><ArrowRightLeft className="h-4 w-4" /> To order</Button>
        </section>
      )}

      {data.activity.length > 0 && (
        <section className="rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
          <h2 className="mb-2 text-sm font-medium text-ink">Activity</h2>
          <ul className="space-y-1.5">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-ink">{EVENT_LABEL[a.event_type] ?? a.event_type}{a.message ? <span className="text-muted"> — {a.message}</span> : null}</span>
                <span className="shrink-0 text-muted">{when(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {addingLine && <LineDrawer id={id} onClose={() => setAddingLine(false)} onDone={() => { setAddingLine(false); load() }} />}
      {editLine && <EditLineDrawer id={id} line={editLine} currency={doc.currency} onClose={() => setEditLine(null)} onDone={() => { setEditLine(null); load() }} />}
      {pickingCustomer && <CustomerPicker contactId={contact?.id ?? null} companyId={company?.id ?? null} onClose={() => setPickingCustomer(false)} onSelect={setCustomer} />}
      {addingCustomer && <NewCustomerForm onClose={() => setAddingCustomer(false)} onCreated={(contactId, companyId) => { setAddingCustomer(false); patch({ contactId, companyId }) }} />}
      {sending && <SendModal id={id} doc={doc} contact={contact} onClose={() => setSending(false)} onSent={() => { setSending(false); load() }} onPreview={openPreview} onPatch={patch} />}
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1 text-subtle"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
  if (state === 'saved') return <span className="inline-flex items-center gap-1 text-success"><Check className="h-3 w-3" /> Saved</span>
  if (state === 'error') return <span className="inline-flex items-center gap-1 text-danger"><CircleAlert className="h-3 w-3" /> Save failed</span>
  return null
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) { return <div className="flex items-center justify-between py-0.5"><span className="text-muted">{label}</span><span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</span></div> }
function ReadNote({ label, value }: { label: string; value: string }) { return <div className="rounded-card border border-hairline bg-surface p-3 shadow-e1"><p className="mb-1 text-xs font-medium text-muted">{label}</p><p className="whitespace-pre-wrap text-sm text-subtle">{value}</p></div> }
function NoteField({ label, hint, defaultValue, onSave, disabled, rows = 2 }: { label: string; hint: string; defaultValue: string | null; onSave: (v: string | null) => void; disabled?: boolean; rows?: number }) {
  return <div className="space-y-1"><Label className="text-xs">{label} <span className="font-normal text-muted">· {hint}</span></Label><Textarea defaultValue={defaultValue ?? ''} rows={rows} disabled={disabled} maxLength={20000} onBlur={(e) => onSave(e.target.value.trim() || null)} placeholder="—" /></div>
}

function SendModal({ id, doc, contact, onClose, onSent, onPreview, onPatch }: { id: string; doc: Doc; contact: { name: string | null; email: string | null } | null; onClose: () => void; onSent: () => void; onPreview: () => void; onPatch: (f: Record<string, unknown>) => void }) {
  const [name, setName] = useState(contact?.name ?? '')
  const [email, setEmail] = useState(contact?.email ?? doc.last_emailed_to ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Your proposal ${doc.number}`)
  const [message, setMessage] = useState('')
  const [expires, setExpires] = useState(doc.expires_at ? String(doc.expires_at).slice(0, 10) : '')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  async function send() {
    if (!emailOk) { toast.error('Enter a valid recipient email.'); return }
    if (busy) return
    setBusy(true)
    if (expires && expires !== (doc.expires_at ? String(doc.expires_at).slice(0, 10) : '')) onPatch({ expiresAt: new Date(expires).toISOString() })
    const res = await fetch(`/api/core/proposals/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipientEmail: email.trim(), recipientName: name.trim() || null, cc: cc.trim() || null, subject: subject.trim() || null, message: message.trim() || null }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && d.ok) { setLink(d.link); toast.success(`Sent to ${email.trim()}.`) }
    else toast.error(d.error === 'send_failed' ? 'The email provider rejected the send. The proposal was NOT marked as sent.' : (d.error || 'Could not send the proposal.'))
  }

  return (
    <Drawer open onClose={() => (link ? onSent() : onClose())} title="Send proposal"
      footer={<div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onPreview}><Eye className="h-4 w-4" /> Preview</Button>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => (link ? onSent() : onClose())}>{link ? 'Done' : 'Cancel'}</Button>{!link && <Button size="sm" loading={busy} disabled={!emailOk || busy} onClick={send}><Send className="h-4 w-4" /> Send</Button>}</div>
      </div>}>
      {link ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-card border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"><Check className="h-4 w-4" /> Sent to {email}.</div>
          <div className="space-y-1"><Label className="text-xs">Public proposal link</Label><div className="flex items-center gap-2"><Input readOnly value={link} className="text-xs" /><Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); toast.success('Copied.') }}><Copy className="h-4 w-4" /></Button></div></div>
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline"><ExternalLink className="h-4 w-4" /> Open the customer page</a>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">A branded email with a secure link is sent via Resend. The proposal is marked <strong>sent</strong> only if the provider accepts it.</p>
          <div className="space-y-1.5"><Label>Recipient name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" /></div>
          <div className="space-y-1.5"><Label>Recipient email <span className="text-danger">*</span></Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="customer@example.com" className={!email || emailOk ? '' : 'border-danger'} />{email && !emailOk && <p className="text-xs text-danger">Enter a valid email address.</p>}{emailOk && <p className="text-xs text-muted">Will be sent to <strong>{email.trim()}</strong>.</p>}</div>
          <div className="space-y-1.5"><Label>CC (optional)</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} type="email" placeholder="cc@example.com" /></div>
          <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></div>
          <div className="space-y-1.5"><Label>Message</Label><Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={5000} placeholder="Short note to the customer (optional)" /></div>
          <div className="space-y-1.5"><Label>Expiration date</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        </div>
      )}
    </Drawer>
  )
}

function NewCustomerForm({ onClose, onCreated }: { onClose: () => void; onCreated: (contactId: string, companyId: string | null) => void }) {
  const [f, setF] = useState({ name: '', companyName: '', email: '', phone: '', address: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [dupes, setDupes] = useState<Array<{ id: string; name: string | null; email: string | null; phone: string | null }> | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function create(force: boolean) {
    if (!f.name.trim()) { toast.error('Name is required.'); return }
    setBusy(true)
    const res = await fetch('/api/core/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, force }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !d.ok) { toast.error(d.error || 'Could not create the customer.'); return }
    if (d.created === false) { setDupes(d.duplicates); return }
    toast.success('Customer created.'); onCreated(d.contact.id, d.companyId ?? null)
  }

  return (
    <Drawer open onClose={onClose} title="New customer"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={busy} onClick={() => create(false)}>Create &amp; select</Button></div>}>
      <div className="space-y-4">
        {dupes && (
          <div className="space-y-2 rounded-card border border-amber-300/50 bg-amber-50 p-3">
            <p className="text-sm text-amber-900">A customer with this email or phone already exists. Select it, or create a new one anyway.</p>
            {dupes.map((d) => <button key={d.id} onClick={() => onCreated(d.id, null)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-left text-sm hover:bg-sunken"><span className="text-ink">{d.name || 'Unknown'}</span><span className="text-xs text-muted">{[d.email, d.phone].filter(Boolean).join(' · ')}</span></button>)}
            <Button size="sm" variant="outline" loading={busy} onClick={() => create(true)}>Create new anyway</Button>
          </div>
        )}
        <div className="space-y-1.5"><Label>Full name <span className="text-danger">*</span></Label><Input value={f.name} onChange={set('name')} placeholder="Jane Buyer" maxLength={300} /></div>
        <div className="space-y-1.5"><Label>Company</Label><Input value={f.companyName} onChange={set('companyName')} placeholder="Optional" maxLength={300} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Email</Label><Input value={f.email} onChange={set('email')} type="email" placeholder="jane@example.com" /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={f.phone} onChange={set('phone')} placeholder="Optional" /></div>
        </div>
        <div className="space-y-1.5"><Label>Billing address</Label><Textarea value={f.address} onChange={set('address')} rows={2} placeholder="Optional" maxLength={1000} /></div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={set('notes')} rows={2} placeholder="Optional" maxLength={4000} /></div>
      </div>
    </Drawer>
  )
}

interface PickProduct { id: string; name: string; sku: string | null; price: number | null }
interface PickComp { id: string; name: string; sku: string | null; image_url: string | null; price_cents: number | null; status: string }
interface PickVar { id: string; name: string; sku: string | null; image_url: string | null; price_override_cents: number | null; status: string }

function LineDrawer({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [products, setProducts] = useState<PickProduct[] | null>(null)
  const [q, setQ] = useState('')
  const [product, setProduct] = useState<PickProduct | null>(null)
  const [components, setComponents] = useState<PickComp[]>([])
  const [variants, setVariants] = useState<PickVar[]>([])
  const [componentId, setComponentId] = useState<string | null>(null)
  const [compVariants, setCompVariants] = useState<PickVar[]>([])
  const [variantId, setVariantId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [discount, setDiscount] = useState('')
  const [busy, setBusy] = useState(false)
  const [inv, setInv] = useState<{ availability: string; available: number; incoming: number; nextArrival: string | null } | null>(null)
  const addedRef = useRef(0)

  useEffect(() => { fetch('/api/core/products').then((r) => r.json()).then((d) => setProducts(d.products ?? [])).catch(() => setProducts([])) }, [])
  useEffect(() => {
    let alive = true
    const kind = variantId ? 'variant' : componentId ? 'component' : product ? 'product' : null
    const iid = variantId || componentId || product?.id
    void (async () => {
      if (!kind || !iid) { if (alive) setInv(null); return }
      try { const d = await (await fetch(`/api/core/inventory/item?itemKind=${kind}&itemId=${iid}`)).json(); if (alive) setInv({ availability: d.availability, available: d.summary.available, incoming: d.summary.incoming, nextArrival: d.summary.nextArrival }) }
      catch { if (alive) setInv(null) }
    })()
    return () => { alive = false }
  }, [product, componentId, variantId])
  const matches = (products ?? []).filter((p) => { const s = q.trim().toLowerCase(); return s ? [p.name, p.sku].some((v) => v?.toLowerCase().includes(s)) : true }).slice(0, 8)

  function pickProduct(p: PickProduct) {
    setProduct(p); setQ(''); setVariantId(null); setComponentId(null); setCompVariants([]); setDescription(p.name); setPrice(p.price != null ? String(p.price) : '')
    fetch(`/api/core/products/${p.id}/variants`).then((r) => r.json()).then((d) => setVariants((d.variants ?? []).filter((v: PickVar) => v.status !== 'discontinued'))).catch(() => setVariants([]))
    fetch(`/api/core/products/${p.id}/components`).then((r) => r.json()).then((d) => setComponents((d.components ?? []).filter((c: PickComp) => c.status !== 'discontinued'))).catch(() => setComponents([]))
  }
  function pickComponent(cid: string) {
    setComponentId(cid || null); setVariantId(null); setCompVariants([])
    const cmp = components.find((x) => x.id === cid)
    if (cmp) { setDescription(`${product?.name ?? ''} — ${cmp.name}`.trim()); if (cmp.price_cents != null) setPrice(centsToInput(cmp.price_cents)); fetch(`/api/core/components/${cid}/variants`).then((r) => r.json()).then((d) => setCompVariants((d.variants ?? []).filter((v: PickVar) => v.status !== 'discontinued'))).catch(() => setCompVariants([])) }
    else if (product) { setDescription(product.name); setPrice(product.price != null ? String(product.price) : '') }
  }
  function pickCompVariant(vid: string) { setVariantId(vid || null); const v = compVariants.find((x) => x.id === vid); const cmp = components.find((x) => x.id === componentId); if (v) { setDescription(`${product?.name ?? ''} — ${cmp?.name ?? ''} — ${v.name}`.replace(/\s+—\s+$/, '').trim()); if (v.price_override_cents != null) setPrice(centsToInput(v.price_override_cents)) } }
  function pickVariant(vid: string) { setVariantId(vid || null); const v = variants.find((x) => x.id === vid); if (v) { setDescription(`${product?.name ?? ''} — ${v.name}`.trim()); if (v.price_override_cents != null) setPrice(centsToInput(v.price_override_cents)) } }
  function reset() { setProduct(null); setComponents([]); setVariants([]); setComponentId(null); setCompVariants([]); setVariantId(null); setDescription(''); setPrice(''); setDiscount(''); setQuantity('1') }

  async function add(keepOpen: boolean) {
    const qty = Number(quantity); const cents = inputToCents(price); const disc = inputToCents(discount) ?? 0
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (cents == null || Number.isNaN(cents)) { toast.error('Enter a valid unit price.'); return }
    setBusy(true)
    const res = await fetch(`/api/core/proposals/${id}/lines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product?.id ?? null, componentId, variantId, description: description.trim() || null, quantity: qty, unit_price_cents: cents, discount_cents: disc }) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (res.ok && d.ok) { addedRef.current++; toast.success('Line added.'); if (keepOpen && product) { setVariantId(null); setComponentId(null); setDiscount(''); toast.message('Pick another component from the same product.') } else if (keepOpen) reset(); else onDone() }
    else toast.error(d.error === 'locked' ? 'This proposal is locked.' : (d.error || 'Could not add the line.'))
  }

  return (
    <Drawer open onClose={() => (addedRef.current ? onDone() : onClose())} title="Add line from catalog"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => (addedRef.current ? onDone() : onClose())}>Done</Button>{product && components.length > 0 && <Button variant="outline" size="sm" loading={busy} onClick={() => add(true)}>Add &amp; pick another</Button>}<Button size="sm" loading={busy} onClick={() => add(false)}>Add</Button></div>}>
      <div className="space-y-4">
        {product ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm"><span className="min-w-0"><span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">Catalog</span> <span className="font-medium text-ink">{product.name}</span></span><button onClick={reset} className="shrink-0 text-xs text-subtle hover:text-ink">Clear</button></div>
        ) : (
          <div className="space-y-1.5"><Label>Catalog product</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, or leave blank for a custom line" />
            {q.trim() && <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-hairline p-1">{products == null ? <li className="px-2 py-1 text-xs text-muted">Loading…</li> : matches.length === 0 ? <li className="px-2 py-1 text-xs text-muted">No products match.</li> : matches.map((p) => <li key={p.id}><button onClick={() => pickProduct(p)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sunken"><span className="min-w-0 truncate text-ink">{p.name}{p.sku && <span className="text-muted"> · {p.sku}</span>}</span></button></li>)}</ul>}
          </div>
        )}
        {product && components.length > 0 && <div className="space-y-1.5"><Label>Component (order a single sub-product)</Label><select value={componentId ?? ''} onChange={(e) => pickComponent(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">— whole product —</option>{components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {componentId && compVariants.length > 0 && <div className="space-y-1.5"><Label>Component variant</Label><select value={variantId ?? ''} onChange={(e) => pickCompVariant(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">— none —</option>{compVariants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.sku ? ` · ${v.sku}` : ''}</option>)}</select></div>}
        {product && !componentId && variants.length > 0 && <div className="space-y-1.5"><Label>Variant</Label><select value={variantId ?? ''} onChange={(e) => pickVariant(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">— none —</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.sku ? ` · ${v.sku}` : ''}</option>)}</select></div>}
        {inv && (() => { const av = AVAILABILITY[inv.availability] ?? { label: inv.availability, variant: 'neutral' as const }; const over = Number(quantity) > inv.available
          return <div className="space-y-1 rounded-lg border border-hairline bg-sunken/50 px-3 py-2 text-xs"><div className="flex items-center gap-2"><Badge variant={av.variant}>{av.label}</Badge><span className="text-muted">{inv.available} available{inv.incoming > 0 ? ` · ${inv.incoming} incoming${inv.nextArrival ? ` (exp. ${inv.nextArrival})` : ''}` : ''}</span></div>{over && <p className="text-amber-700">Requested {quantity} exceeds {inv.available} available. You can still add it as a backorder / against incoming stock / made-to-order.</p>}</div>
        })()}
        <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>Qty</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0" step="1" inputMode="decimal" /></div>
          <div className="space-y-1.5"><Label>Unit (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
          <div className="space-y-1.5"><Label>Line disc.</Label><Input value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
        </div>
      </div>
    </Drawer>
  )
}

function EditLineDrawer({ id, line, currency, onClose, onDone }: { id: string; line: Line; currency: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState(line.description ?? '')
  const [quantity, setQuantity] = useState(String(line.quantity))
  const [price, setPrice] = useState(centsToInput(line.unit_price_cents))
  const [discount, setDiscount] = useState(centsToInput(line.discount_cents))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const a = line.custom_attributes ?? {}
  const [hidden, setHidden] = useState(a.hide_image === true)
  const [img, setImg] = useState<string | null>(lineImg(line))

  async function save() {
    const qty = Number(quantity); const cents = inputToCents(price); const disc = inputToCents(discount) ?? 0
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (cents == null || Number.isNaN(cents)) { toast.error('Enter a valid unit price.'); return }
    setBusy(true)
    const res = await fetch(`/api/core/proposals/${id}/lines/${line.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: description.trim() || null, quantity: qty, unit_price_cents: cents, discount_cents: disc }) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (res.ok && d.ok) { toast.success('Line updated.'); onDone() } else toast.error(d.error || 'Could not update the line.')
  }
  async function setImage(patch: { hide?: boolean; proposalImageUrl?: string | null }) {
    const res = await fetch(`/api/core/proposals/${id}/lines/${line.id}/image`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) { toast.error('Could not update the image.'); return false }
    return true
  }
  async function onFile(file: File | null) {
    if (!file) return
    setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    const up = await fetch('/api/core/uploads', { method: 'POST', body: fd }); const ud = await up.json().catch(() => ({}))
    if (!up.ok || !ud.url) { setUploading(false); toast.error(ud.error || 'Upload failed.'); return }
    if (await setImage({ proposalImageUrl: ud.url, hide: false })) { setImg(ud.url); setHidden(false); toast.success('Image updated.') }
    setUploading(false)
  }

  return (
    <Drawer open onClose={onClose} title="Edit line" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={busy} onClick={save}>Save</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>Qty</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0" step="1" /></div>
          <div className="space-y-1.5"><Label>Unit ({currency.toUpperCase()})</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" /></div>
          <div className="space-y-1.5"><Label>Discount</Label><Input value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" min="0" step="0.01" /></div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Proposal image</Label>
          <div className="flex items-center gap-3">
            {hidden || !img
              ? <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-sunken text-muted"><ImageOff className="h-5 w-5" /></span>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={img} alt="" className="h-14 w-14 rounded-lg border border-hairline object-cover" />}
            <div className="flex flex-wrap gap-2">
              <label className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'cursor-pointer', uploading && 'pointer-events-none opacity-60')}><Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload'}<input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></label>
              <Button size="sm" variant="ghost" onClick={async () => { const next = !hidden; if (await setImage({ hide: next })) setHidden(next) }}>{hidden ? 'Show image' : 'Hide image'}</Button>
              {(a.proposal_image_url as string) && <Button size="sm" variant="ghost" onClick={async () => { if (await setImage({ proposalImageUrl: null })) { setImg((a.snapshot as { image_url?: string })?.image_url ?? null); toast.success('Reverted to catalog image.') } }}>Use catalog image</Button>}
            </div>
          </div>
          <p className="text-xs text-muted">Uses the catalog image by default. Upload a proposal-specific image or hide it from this proposal.</p>
        </div>
      </div>
    </Drawer>
  )
}
