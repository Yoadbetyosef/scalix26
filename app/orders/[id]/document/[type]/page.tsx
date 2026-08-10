import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import {
  ORDER_DOC_META, isOrderDocType, loadDocContext, orderDocNumber, specRows, totalCarats, validUntil,
} from '@/lib/orders/documents'
import { PrintButton } from '@/components/studio/print-button'
import { DocumentBranding } from '@/components/orders/document-branding'

// Printable Estimate / Quote for an order. Rendered on the tenant's own screen and saved as PDF from the
// browser's print dialog — the same route the Studio documents take. Insurance claims are a stated use,
// so the piece is described attribute by attribute rather than summarised.

export const dynamic = 'force-dynamic'

const SYMBOL: Record<string, string> = { usd: '$', cad: 'CA$', gbp: '£', eur: '€', ils: '₪' }
const money = (cents: number, cur: string) =>
  `${SYMBOL[cur] ?? `${cur.toUpperCase()} `}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


// ── THE PAGE TITLE IS THE TENANT'S, AND ONLY THE TENANT'S ───────────────────────────────────────────
//
// Chrome prints document.title at the top of every printed page. This route used to inherit the root
// layout's "<platform> — AI Employee Platform", so every estimate a customer received had our name
// printed across the top of it. The title is the tenant's business name and the document's own
// identity; nothing else belongs in it, because a customer reading it is not our customer.
export async function generateMetadata({ params }: { params: Promise<{ id: string; type: string }> }) {
  try {
    const a = await requireOrdersAccess()
    if (!a) return { title: '' }
    const { id, type } = await params
    const [order, { business }] = await Promise.all([getOrder(id), loadDocContext(a.tenantId)])
    const label = type.charAt(0).toUpperCase() + type.slice(1)
    const num = order?.orderNumber ? ` ${order.orderNumber}` : ''
    return { title: [business.businessName, `${label}${num}`].filter(Boolean).join(' · '), robots: { index: false, follow: false } }
  } catch {
    // A title is not worth failing a document render over.
    return { title: '' }
  }
}

export default async function OrderDocumentPage({ params }: { params: Promise<{ id: string; type: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const { id, type } = await params
  if (!isOrderDocType(type)) notFound()
  const o = await getOrder(id)
  if (!o) notFound()

  const { branding, business } = await loadDocContext(a.tenantId)
  const meta = ORDER_DOC_META[type]
  const accent = branding.accent
  const issued = new Date().toISOString().slice(0, 10)
  const carats = totalCarats(o.lineItems)
  const addr = [business.address, [business.city, business.state, business.zip].filter(Boolean).join(', ')].filter(Boolean)

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-10 text-neutral-900 print:py-4">
      <div className="mb-6 flex items-center justify-end gap-2 print:hidden">
        <DocumentBranding needsLogo={!branding.logoUrl} />
        <PrintButton />
      </div>

      {/* printColorAdjust so the brand bar survives the browser's print default of dropping backgrounds */}
      {accent && <div className="mb-6 h-1.5 w-full rounded-full print:mb-4" style={{ background: accent, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />}

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* The wordmark renders ONCE.
              
              This was a logo <img> followed by an <h1> of the same business name, so every tenant
              whose logo contains their name — which is most brand logos — had it printed twice on
              every document. A logo IS the name; if one exists it stands alone, and the name is
              carried by the img's alt text for anyone who cannot see it. */}
          {branding.logoUrl
            // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded logo, not a static asset
            ? <img src={branding.logoUrl} alt={business.businessName ?? ''} className="mb-2 h-14 w-auto max-w-[200px] object-contain" />
            : <h1 className="text-2xl font-bold tracking-tight">{business.businessName ?? 'Our business'}</h1>}
          {addr.map((l, i) => <p key={i} className="text-sm text-neutral-500">{l}</p>)}
          <p className="text-sm text-neutral-500">{[business.email, business.phone, business.website].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold uppercase tracking-wide" style={accent ? { color: accent } : undefined}>{meta.title}</p>
          <p className="text-sm text-neutral-500">#{orderDocNumber(type, o.orderNumber)}</p>
          <p className="text-sm text-neutral-500">Issued {issued}</p>
          {type === 'quote' && <p className="text-sm text-neutral-500">Valid until {validUntil(issued, branding.validityDays)}</p>}
          <p className="mt-1 font-mono text-xs text-neutral-400">Order {o.orderNumber}</p>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Prepared for</p>
          <p className="text-sm font-medium">{o.customerName ?? '—'}</p>
          {o.customerEmail && <p className="text-sm text-neutral-500">{o.customerEmail}</p>}
          {o.customerPhone && <p className="text-sm text-neutral-500">{o.customerPhone}</p>}
        </div>
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Summary</p>
          <p className="text-sm text-neutral-700">{meta.blurb}</p>
          {carats > 0 && <p className="mt-1 text-sm text-neutral-700">Total stone weight <span className="font-medium">{carats.toFixed(2)} ct</span></p>}
          {o.isCustomDesign && <p className="mt-1 text-sm font-medium" style={accent ? { color: accent } : undefined}>Custom design</p>}
        </div>
      </section>

      <section className="space-y-4">
        {o.lineItems.map((l, i) => {
          const rows = specRows(l)
          return (
            <article key={l.id} className="break-inside-avoid rounded-lg border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">Item {i + 1}</p>
                  <h2 className="text-base font-semibold">{l.productName}</h2>
                  {l.description && <p className="mt-0.5 text-sm text-neutral-600">{l.description}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-neutral-400">Qty {l.quantity}</p>
                  <p className="text-base font-semibold">{money(l.lineTotalCents, o.currency)}</p>
                  {l.quantity > 1 && <p className="text-xs text-neutral-400">{money(l.unitPriceCents, o.currency)} each</p>}
                </div>
              </div>

              {rows.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-neutral-100 pt-3 text-sm sm:grid-cols-3">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex min-w-0 justify-between gap-2">
                      <dt className="text-neutral-400">{k}</dt>
                      <dd className="truncate text-right font-medium text-neutral-800" title={v}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          )
        })}
        {o.lineItems.length === 0 && <p className="text-sm text-neutral-400">No items on this order yet.</p>}
      </section>

      <section className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-neutral-500">Subtotal</dt><dd className="font-medium">{money(o.subtotalCents, o.currency)}</dd></div>
          {o.depositCents > 0 && <div className="flex justify-between"><dt className="text-neutral-500">Deposit received</dt><dd className="font-medium">−{money(o.depositCents, o.currency)}</dd></div>}
          <div className="flex justify-between border-t border-neutral-200 pt-1.5 text-base">
            <dt className="font-medium text-neutral-600">{o.depositCents > 0 ? 'Balance' : 'Total'}</dt>
            <dd className="font-bold" style={accent ? { color: accent } : undefined}>{money(o.depositCents > 0 ? o.balanceCents : o.subtotalCents, o.currency)}</dd>
          </div>
        </dl>
      </section>

      {o.clientRequirements && (
        <section className="mt-6 break-inside-avoid">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Client requirements</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{o.clientRequirements}</p>
        </section>
      )}

      {o.publicNotes && (
        <section className="mt-6 break-inside-avoid">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{o.publicNotes}</p>
        </section>
      )}

      {branding.terms && (
        <section className="mt-6 break-inside-avoid border-t border-neutral-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Terms</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-500">{branding.terms}</p>
        </section>
      )}

      <footer className="mt-8 text-xs text-neutral-400">
        {type === 'estimate'
          ? 'This estimate describes the piece as specified and is not a binding offer. Final pricing may change if the specification changes.'
          : `This quote is valid until ${validUntil(issued, branding.validityDays)} and reflects the specification described above.`}
      </footer>
    </main>
  )
}
