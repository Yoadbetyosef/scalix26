'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, Send, Copy, Eye, ArrowRightLeft, User, Check, Loader2, CircleAlert, Archive } from 'lucide-react'
import { CustomerPicker } from '@/components/commerce/customer-picker'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCents, inputToCents, centsToInput } from '@/lib/core/money-format'
import { AVAILABILITY } from '@/components/commerce/product-inventory'
import { toast } from 'sonner'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { draft: 'draft', ready: 'pending', sent: 'open', viewed: 'open', accepted: 'active', declined: 'closed', expired: 'closed', converted: 'resolved', paid: 'active', unpaid: 'draft', partial: 'pending', rejected: 'closed', void: 'closed' }
interface Doc { id: string; number: string; status: string; currency: string; subtotal_cents: number; discount_cents: number; overall_discount_cents: number; tax_cents: number; total_cents: number; contact_id: string | null; company_id: string | null; expires_at: string | null; customer_notes: string | null; internal_notes: string | null; terms: string | null; sent_at: string | null; first_viewed_at: string | null; last_viewed_at: string | null; accepted_at: string | null; accepted_by_name: string | null; declined_at: string | null; converted_invoice_id: string | null; converted_order_id: string | null }
interface Line { id: string; description: string | null; quantity: number; unit_price_cents: number; discount_cents: number; line_total_cents: number; product_id: string | null; component_id: string | null; variant_id: string | null; custom_attributes: Record<string, unknown> }
interface Full { type: 'proposal' | 'estimate' | 'quote'; editable: boolean; document: Doc; lines: Line[]; contact: { id: string; name: string | null; phone: string | null; email: string | null } | null; company: { id: string; name: string } | null }
const when = (iso: string | null) => { if (!iso) return null; try { return new Date(iso).toLocaleString() } catch { return iso } }

export function ProposalBuilder({ id }: { id: string }) {
  const router = useRouter()
  const [data, setData] = useState<Full | null | 'notfound'>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [addingLine, setAddingLine] = useState(false)
  const [editLine, setEditLine] = useState<Line | null>(null)
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const [sending, setSending] = useState(false)
  const [conv, setConv] = useState<{ target: string; id: string; number?: string; existed: boolean } | null>(null)

  const load = useCallback(() => fetch(`/api/core/proposals/${id}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setData('notfound')), [id])
  useEffect(() => { load() }, [load])

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    setSave('saving')
    const res = await fetch(`/api/core/proposals/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) }).catch(() => null)
    if (res && res.ok) { setSave('saved'); load(); setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 1500) }
    else setSave('error')
  }, [id, load])

  async function setCustomer(v: { contactId: string | null; companyId: string | null }) {
    await patch({ contactId: v.contactId, companyId: v.companyId }); setPickingCustomer(false)
  }
  async function removeLine(lineId: string) {
    const res = await fetch(`/api/core/proposals/${id}/lines/${lineId}`, { method: 'DELETE' })
    if (res.ok) load(); else toast.error('Could not remove the line.')
  }
  async function duplicate() {
    const res = await fetch(`/api/core/proposals/${id}/duplicate`, { method: 'POST' })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { toast.success('Proposal duplicated.'); router.push(`/commerce/proposals/${d.id}`) } else toast.error(d.error || 'Could not duplicate.')
  }
  async function archive() {
    await patch({ status: 'declined' }); toast.success('Proposal archived.')
  }
  async function convert(target: 'invoice' | 'order') {
    const res = await fetch(`/api/core/proposals/${id}/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setConv({ target, id: d.invoiceId || d.orderId, number: d.number || d.orderNumber, existed: !!d.idempotent }); toast.success(d.idempotent ? `Already converted to ${target}.` : `Converted to ${target}.`); load() }
    else toast.error(d.error || 'Conversion failed.')
  }

  if (data === 'notfound') return <div className="mx-auto max-w-3xl px-4 py-10 text-center text-sm text-muted">Proposal not found.</div>
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-6"><Skeleton className="h-16 w-full" /></div>

  const { document: doc, lines, contact, company, editable } = data
  const RO = !editable

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link href="/commerce/proposals" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> Proposals</Link>

      {RO && <div className="mb-4 rounded-card border border-hairline bg-sunken px-4 py-2.5 text-sm text-subtle">This is a legacy {data.type} — shown read-only for history. New edits happen on proposals.</div>}

      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-light tracking-tight text-ink">{doc.number}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted"><Badge variant={STATUS_VARIANT[doc.status] ?? 'neutral'}>{doc.status}</Badge><SaveIndicator state={save} /></div>
        </div>
        {!RO && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate</Button>
            <a href={doc.status !== 'draft' ? `#preview` : undefined}><Button size="sm" variant="outline" onClick={() => window.open(`/commerce/proposals/${id}?preview=1`, '_blank')}><Eye className="h-4 w-4" /> Preview</Button></a>
            <Button size="sm" onClick={() => setSending(true)}><Send className="h-4 w-4" /> Send</Button>
            <Button size="sm" variant="ghost" onClick={archive}><Archive className="h-4 w-4" /> Archive</Button>
          </div>
        )}
      </header>

      {conv && (
        <div className="mb-5 flex items-center justify-between gap-2 rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="text-ink">{conv.existed ? 'Already converted' : 'Converted'} to {conv.target} {conv.number ?? ''}</span>
          <Link href={conv.target === 'order' ? `/orders/${conv.id}` : `/commerce/invoices/${conv.id}`} className="font-medium text-accent-strong hover:underline">Open →</Link>
        </div>
      )}

      {/* Customer + meta */}
      <section className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-card border border-hairline bg-surface p-3 shadow-e1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-strong"><User className="h-4 w-4" /></span>
            {contact ? <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{contact.name || 'Unknown'}{company && <span className="font-normal text-muted"> · {company.name}</span>}</p><p className="truncate text-xs text-muted">{[contact.phone, contact.email].filter(Boolean).join(' · ') || '—'}</p></div> : <p className="text-sm text-muted">No customer</p>}
          </div>
          {!RO && <Button size="sm" variant="outline" onClick={() => setPickingCustomer(true)}>{contact ? 'Change' : 'Add'}</Button>}
        </div>
        <div className="rounded-card border border-hairline bg-surface p-3 shadow-e1">
          <Label className="text-xs text-muted">Expiration date</Label>
          <Input type="date" defaultValue={doc.expires_at ? String(doc.expires_at).slice(0, 10) : ''} disabled={RO} onChange={(e) => patch({ expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null })} className="mt-1" />
        </div>
      </section>

      {/* Lines */}
      <section className="mb-5 overflow-hidden rounded-card border border-hairline bg-surface shadow-e1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h2 className="text-sm font-medium text-ink">Line items</h2>
          {!RO && <Button size="sm" variant="ghost" onClick={() => setAddingLine(true)}><Plus className="h-4 w-4" /> Add from catalog</Button>}
        </div>
        {lines.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No items yet. Add products, components or variants from your catalog.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Qty</th><th className="px-4 py-2 font-medium">Unit</th><th className="px-4 py-2 font-medium">Disc.</th><th className="px-4 py-2 font-medium">Total</th>{!RO && <th className="px-2 py-2"></th>}</tr></thead>
              <tbody>
                {lines.map((l) => {
                  const a = l.custom_attributes ?? {}
                  return (
                    <tr key={l.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2">
                        <button disabled={RO} onClick={() => setEditLine(l)} className="text-left text-ink hover:text-accent-strong disabled:cursor-default">{l.description || '—'}</button>
                        <div className="text-xs text-muted">{[(a.sku as string) || null, l.component_id ? 'component' : null, l.variant_id ? 'variant' : null].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-2 text-subtle">{l.quantity}</td>
                      <td className="px-4 py-2 text-subtle">{formatCents(l.unit_price_cents, doc.currency)}</td>
                      <td className="px-4 py-2 text-subtle">{l.discount_cents ? formatCents(l.discount_cents, doc.currency) : '—'}</td>
                      <td className="px-4 py-2 text-ink">{formatCents(l.line_total_cents, doc.currency)}</td>
                      {!RO && <td className="px-2 py-2"><button onClick={() => removeLine(l.id)} className="text-subtle hover:text-danger" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Totals + discount/tax */}
      <section className="mb-5 rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
        <h2 className="mb-2 text-sm font-medium text-ink">Totals</h2>
        <Row label="Subtotal" value={formatCents(doc.subtotal_cents, doc.currency)} />
        <div className="flex items-center justify-between py-1"><span className="text-muted">Overall discount</span><Input type="number" min="0" step="0.01" disabled={RO} defaultValue={centsToInput(doc.overall_discount_cents)} onBlur={(e) => { const c = inputToCents(e.target.value); if (c != null) patch({ overallDiscountCents: c }) }} className="h-8 w-28 text-right" /></div>
        <div className="flex items-center justify-between py-1"><span className="text-muted">Tax</span><Input type="number" min="0" step="0.01" disabled={RO} defaultValue={centsToInput(doc.tax_cents)} onBlur={(e) => { const c = inputToCents(e.target.value); if (c != null) patch({ taxCents: c }) }} className="h-8 w-28 text-right" /></div>
        <div className="mt-1 border-t border-hairline pt-1"><Row label="Total" value={formatCents(doc.total_cents, doc.currency)} strong /></div>
      </section>

      {/* Notes + terms */}
      {!RO ? (
        <section className="mb-5 grid gap-4 sm:grid-cols-2">
          <NoteField label="Customer-facing notes" hint="Shown on the proposal page" defaultValue={doc.customer_notes} onSave={(v) => patch({ customerNotes: v })} />
          <NoteField label="Internal notes" hint="Never shown to the customer" defaultValue={doc.internal_notes} onSave={(v) => patch({ internalNotes: v })} />
          <div className="sm:col-span-2"><NoteField label="Terms & conditions" hint="Shown on the proposal page" defaultValue={doc.terms} onSave={(v) => patch({ terms: v })} rows={3} /></div>
        </section>
      ) : (
        <section className="mb-5 space-y-3">
          {doc.customer_notes && <ReadNote label="Customer notes" value={doc.customer_notes} />}
          {doc.terms && <ReadNote label="Terms" value={doc.terms} />}
        </section>
      )}

      {/* Tracking */}
      {(doc.sent_at || doc.first_viewed_at || doc.accepted_at || doc.declined_at) && (
        <section className="mb-5 rounded-card border border-hairline bg-surface p-4 text-sm shadow-e1">
          <h2 className="mb-2 text-sm font-medium text-ink">Activity</h2>
          <div className="space-y-1 text-xs">
            {doc.sent_at && <Track label="Sent" value={when(doc.sent_at)} />}
            {doc.first_viewed_at && <Track label="First viewed" value={when(doc.first_viewed_at)} />}
            {doc.last_viewed_at && <Track label="Last viewed" value={when(doc.last_viewed_at)} />}
            {doc.accepted_at && <Track label={`Accepted${doc.accepted_by_name ? ` by ${doc.accepted_by_name}` : ''}`} value={when(doc.accepted_at)} />}
            {doc.declined_at && <Track label="Declined" value={when(doc.declined_at)} />}
          </div>
        </section>
      )}

      {/* Convert */}
      {!RO && (
        <section className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Convert{doc.status !== 'accepted' ? ' (accept first for the standard flow)' : ''}:</span>
          <Button size="sm" variant="outline" onClick={() => convert('invoice')}><ArrowRightLeft className="h-4 w-4" /> To invoice</Button>
          <Button size="sm" variant="outline" onClick={() => convert('order')}><ArrowRightLeft className="h-4 w-4" /> To order</Button>
        </section>
      )}

      {addingLine && <LineDrawer id={id} onClose={() => setAddingLine(false)} onDone={() => { setAddingLine(false); load() }} />}
      {editLine && <EditLineDrawer id={id} line={editLine} currency={doc.currency} onClose={() => setEditLine(null)} onDone={() => { setEditLine(null); load() }} />}
      {pickingCustomer && <CustomerPicker contactId={contact?.id ?? null} companyId={company?.id ?? null} onClose={() => setPickingCustomer(false)} onSelect={setCustomer} />}
      {sending && <SendDrawer id={id} defaultEmail={contact?.email ?? ''} onClose={() => setSending(false)} onDone={() => { setSending(false); load() }} />}
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
function Track({ label, value }: { label: string; value: string | null }) { return <div className="flex items-center justify-between"><span className="text-muted">{label}</span><span className="text-subtle">{value}</span></div> }
function ReadNote({ label, value }: { label: string; value: string }) { return <div className="rounded-card border border-hairline bg-surface p-3 shadow-e1"><p className="mb-1 text-xs font-medium text-muted">{label}</p><p className="whitespace-pre-wrap text-sm text-subtle">{value}</p></div> }
function NoteField({ label, hint, defaultValue, onSave, rows = 2 }: { label: string; hint: string; defaultValue: string | null; onSave: (v: string | null) => void; rows?: number }) {
  return (
    <div className="space-y-1"><Label className="text-xs">{label} <span className="font-normal text-muted">· {hint}</span></Label>
      <Textarea defaultValue={defaultValue ?? ''} rows={rows} maxLength={20000} onBlur={(e) => onSave(e.target.value.trim() || null)} placeholder="—" />
    </div>
  )
}

// ── Catalog picker (Product → Component → Variant), snapshots sku/image/labels onto the line ──────────
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
  // Live availability for the most specific selection (variant → component → product).
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
    setProduct(p); setQ(''); setVariantId(null); setComponentId(null); setCompVariants([])
    setDescription(p.name); setPrice(p.price != null ? String(p.price) : '')
    fetch(`/api/core/products/${p.id}/variants`).then((r) => r.json()).then((d) => setVariants((d.variants ?? []).filter((v: PickVar) => v.status !== 'discontinued'))).catch(() => setVariants([]))
    fetch(`/api/core/products/${p.id}/components`).then((r) => r.json()).then((d) => setComponents((d.components ?? []).filter((c: PickComp) => c.status !== 'discontinued'))).catch(() => setComponents([]))
  }
  function pickComponent(cid: string) {
    setComponentId(cid || null); setVariantId(null); setCompVariants([])
    const cmp = components.find((x) => x.id === cid)
    if (cmp) { setDescription(`${product?.name ?? ''} — ${cmp.name}`.trim()); if (cmp.price_cents != null) setPrice(centsToInput(cmp.price_cents)); fetch(`/api/core/components/${cid}/variants`).then((r) => r.json()).then((d) => setCompVariants((d.variants ?? []).filter((v: PickVar) => v.status !== 'discontinued'))).catch(() => setCompVariants([])) }
    else if (product) { setDescription(product.name); setPrice(product.price != null ? String(product.price) : '') }
  }
  function pickCompVariant(vid: string) {
    setVariantId(vid || null)
    const v = compVariants.find((x) => x.id === vid); const cmp = components.find((x) => x.id === componentId)
    if (v) { setDescription(`${product?.name ?? ''} — ${cmp?.name ?? ''} — ${v.name}`.replace(/\s+—\s+$/, '').trim()); if (v.price_override_cents != null) setPrice(centsToInput(v.price_override_cents)) }
  }
  function pickVariant(vid: string) {
    setVariantId(vid || null); const v = variants.find((x) => x.id === vid)
    if (v) { setDescription(`${product?.name ?? ''} — ${v.name}`.trim()); if (v.price_override_cents != null) setPrice(centsToInput(v.price_override_cents)) }
  }
  function reset() { setProduct(null); setComponents([]); setVariants([]); setComponentId(null); setCompVariants([]); setVariantId(null); setDescription(''); setPrice(''); setDiscount(''); setQuantity('1') }

  function snapshot(): Record<string, unknown> {
    const cmp = components.find((x) => x.id === componentId)
    const v = compVariants.find((x) => x.id === variantId) || variants.find((x) => x.id === variantId)
    const sku = v?.sku ?? cmp?.sku ?? product?.sku ?? null
    const image_url = v?.image_url ?? cmp?.image_url ?? null
    return { sku, image_url, labels: { product: product?.name ?? null, component: cmp?.name ?? null, variant: v?.name ?? null } }
  }
  async function add(keepOpen: boolean) {
    const qty = Number(quantity); const cents = inputToCents(price); const disc = inputToCents(discount) ?? 0
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (cents == null || Number.isNaN(cents)) { toast.error('Enter a valid unit price.'); return }
    setBusy(true)
    const res = await fetch(`/api/core/proposals/${id}/lines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product?.id ?? null, componentId, variantId, description: description.trim() || null, quantity: qty, unit_price_cents: cents, discount_cents: disc, customAttributes: snapshot() }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && d.ok) { addedRef.current++; toast.success('Line added.'); if (keepOpen && product) { setVariantId(null); setComponentId(null); setDiscount(''); toast.message('Pick another component from the same product.') } else if (keepOpen) reset(); else onDone() }
    else toast.error(d.error || 'Could not add the line.')
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
        {inv && (() => { const a = AVAILABILITY[inv.availability] ?? { label: inv.availability, variant: 'neutral' as const }; const over = Number(quantity) > inv.available
          return (
            <div className="space-y-1 rounded-lg border border-hairline bg-sunken/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2"><Badge variant={a.variant}>{a.label}</Badge><span className="text-muted">{inv.available} available{inv.incoming > 0 ? ` · ${inv.incoming} incoming${inv.nextArrival ? ` (exp. ${inv.nextArrival})` : ''}` : ''}</span></div>
              {over && <p className="text-amber-700">Requested {quantity} exceeds {inv.available} available. You can still add it as a backorder / against incoming stock / made-to-order.</p>}
            </div>
          ) })()}
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
  async function save() {
    const qty = Number(quantity); const cents = inputToCents(price); const disc = inputToCents(discount) ?? 0
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (cents == null || Number.isNaN(cents)) { toast.error('Enter a valid unit price.'); return }
    setBusy(true)
    const res = await fetch(`/api/core/proposals/${id}/lines/${line.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: description.trim() || null, quantity: qty, unit_price_cents: cents, discount_cents: disc }) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (res.ok && d.ok) { toast.success('Line updated.'); onDone() } else toast.error(d.error || 'Could not update the line.')
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
      </div>
    </Drawer>
  )
}

function SendDrawer({ id, defaultEmail, onClose, onDone }: { id: string; defaultEmail: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(defaultEmail)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  async function send() {
    if (!email.trim()) { toast.error('Enter the customer email.'); return }
    setBusy(true)
    const res = await fetch(`/api/core/proposals/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipientEmail: email.trim() }) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (res.ok && d.ok) { setLink(d.link); toast.success('Proposal sent.') } else toast.error(d.error || 'Could not send the proposal.')
  }
  return (
    <Drawer open onClose={() => (link ? onDone() : onClose())} title="Send proposal" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => (link ? onDone() : onClose())}>{link ? 'Done' : 'Cancel'}</Button>{!link && <Button size="sm" loading={busy} onClick={send}><Send className="h-4 w-4" /> Send</Button>}</div>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">The customer gets a branded email with a secure link to view, accept or decline. Nothing is sent automatically.</p>
        <div className="space-y-1.5"><Label>Customer email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="customer@example.com" /></div>
        {link && <div className="rounded-input border border-hairline bg-sunken p-3 text-xs"><p className="mb-1 font-medium text-ink">Secure link (also emailed):</p><p className="break-all text-subtle">{link}</p></div>}
      </div>
    </Drawer>
  )
}
