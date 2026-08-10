import type { ReactNode } from 'react'
import { ORDER_DOC_META, orderDocNumber, specRows, totalCarats, validUntil, type DocBranding, type DocBusiness, type OrderDocType } from '@/lib/orders/documents'
import { taxLabel, type TaxLine } from '@/lib/tax/canada'
import type { DocumentImage } from '@/lib/orders/attachments'
import type { OrderWithDetails } from '@/lib/orders/types'

// ONE document body, two entry points.
//
// The owner opens /orders/[id]/document/[type] behind auth; the customer opens /e/[token] with no
// account at all. They must render the SAME document — a customer who receives something that differs
// from what the owner printed has been sent a different document, and the discrepancy would surface as
// a dispute rather than as a bug report.
//
// So the body lives here and the two routes are thin. The only difference between them is `toolbar`:
// the owner gets Branding / Print / Send, the customer gets Print. Everything below the toolbar is
// byte-identical by construction rather than by discipline.

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 })
    .format(cents / 100)

export interface OrderDocumentProps {
  order: OrderWithDetails
  type: OrderDocType
  branding: DocBranding
  business: DocBusiness
  images: DocumentImage[]
  /** Null when no delivery province is set, or the rate is unknown. Null renders NO tax line. */
  tax: TaxLine | null
  /** From the selected document template, when there is one. */
  footerNote?: string | null
  /** Owner-only controls. Absent on the customer's copy. */
  toolbar?: ReactNode
}

export function OrderDocumentBody({ order: o, type, branding, business, images, tax, footerNote, toolbar }: OrderDocumentProps) {
  const meta = ORDER_DOC_META[type]
  const accent = branding.accent
  const issued = new Date().toISOString().slice(0, 10)
  const carats = totalCarats(o.lineItems)
  const addr = [business.address, [business.city, business.state, business.zip].filter(Boolean).join(', ')].filter(Boolean)

  // Totals are computed HERE rather than read from orders.balance_cents, because that column is
  // subtotal minus deposit and knows nothing about tax. Reading it would print a balance that does not
  // equal the numbers printed directly above it — the one arithmetic error a customer always catches.
  const taxCents = tax?.amountCents ?? 0
  const totalCents = o.subtotalCents + taxCents
  const dueCents = totalCents - o.depositCents

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-10 text-neutral-900 print:py-4">
      {toolbar && <div className="mb-6 flex items-center justify-end gap-2 print:hidden">{toolbar}</div>}

      {/* printColorAdjust so the brand bar survives the browser's print default of dropping backgrounds */}
      {accent && <div className="mb-6 h-1.5 w-full rounded-full print:mb-4" style={{ background: accent, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />}

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* The wordmark renders ONCE. A logo IS the name; the alt text carries it for anyone who
              cannot see the image. */}
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

      {/* THE PIECE — above the line items, because a customer looks before they read. Public image
          attachments only; break-inside-avoid keeps a photo off a page boundary. */}
      {images.length > 0 && (
        <section className="mb-6 break-inside-avoid">
          <div className={images.length === 1 ? '' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}>
            {images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
              <img
                key={img.id}
                src={img.url}
                alt={img.fileName}
                className={images.length === 1
                  ? 'max-h-80 w-full rounded-lg border border-neutral-200 object-contain'
                  : 'h-40 w-full rounded-lg border border-neutral-200 object-cover'}
              />
            ))}
          </div>
        </section>
      )}

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

          {/* The tax line names its RATE as well as its amount. A customer checking an invoice wants to
              see which rate was applied — and on a cross-province sale it is not the rate they would
              guess from the seller's address. Absent entirely when no destination is recorded: a 0%
              line is a claim that no tax is due, which is a different and more dangerous statement
              than saying nothing. */}
          {tax && (
            <div className="flex justify-between">
              <dt className="text-neutral-500">{taxLabel(tax)} <span className="text-neutral-400">({tax.region})</span></dt>
              <dd className="font-medium">{money(tax.amountCents, o.currency)}</dd>
            </div>
          )}

          {tax && o.depositCents > 0 && (
            <div className="flex justify-between border-t border-neutral-100 pt-1.5"><dt className="text-neutral-500">Total</dt><dd className="font-medium">{money(totalCents, o.currency)}</dd></div>
          )}
          {o.depositCents > 0 && <div className="flex justify-between"><dt className="text-neutral-500">Deposit received</dt><dd className="font-medium">−{money(o.depositCents, o.currency)}</dd></div>}

          <div className="flex justify-between border-t border-neutral-200 pt-1.5 text-base">
            <dt className="font-medium text-neutral-600">{o.depositCents > 0 ? 'Balance due' : 'Total'}</dt>
            <dd className="font-bold" style={accent ? { color: accent } : undefined}>{money(o.depositCents > 0 ? dueCents : totalCents, o.currency)}</dd>
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
        {footerNote ? <p className="mb-1">{footerNote}</p> : null}
        {type === 'estimate'
          ? 'This estimate describes the piece as specified and is not a binding offer. Final pricing may change if the specification changes.'
          : type === 'invoice'
            ? 'Payment is due on the terms above. Please quote the order reference when paying.'
            : `This quote is valid until ${validUntil(issued, branding.validityDays)} and reflects the specification described above.`}
      </footer>
    </main>
  )
}
