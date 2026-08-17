import { loadDocContext } from './documents'
import { publicDocumentImagesForTenant } from './attachments'
import { templateForOrder, applyTemplate } from './templates'
import { getOrderForTenant } from './store'
import { loadTaxRates } from '@/lib/tax/rates-store'
import { rateFor, taxOn, taxFromSnapshot, type TaxLine } from '@/lib/tax/canada'
import type { OrderWithDetails } from './types'
import type { DocBranding, DocBusiness } from './documents'
import type { OrderDocType } from './documents'
import type { DocumentImage } from './attachments'

// Everything a document needs, assembled ONCE.
//
// Both the owner's page and the customer's token page call this, so the two cannot drift: a customer
// who receives something different from what the owner printed has been sent a different document, and
// that surfaces as a dispute rather than a bug report.

export interface OrderDocumentData {
  order: OrderWithDetails
  branding: DocBranding
  business: DocBusiness
  images: DocumentImage[]
  tax: TaxLine | null
  /** Printed beneath the tax line, and ONLY when the order asserts the exemption. */
  pstExemptionNote: string | null
  footerNote: string | null
  templateName: string | null
}

export async function loadOrderDocument(
  tenantId: string,
  orderId: string,
  // WHICH DOCUMENT. Images differ by type and nothing else does, so this is the only reason it is
  // here — see the filter below. Optional, so a caller that has not been updated gets today's
  // behaviour (the whole gallery) rather than an empty one.
  type?: OrderDocType,
): Promise<OrderDocumentData | null> {
  // getOrderForTenant, NOT getOrder: this loader serves the public /e/[token] page as well as the
  // owner's, and getOrder resolves tenancy from the signed-in workspace. With no session it returned
  // null, so a customer opening the link they had just been emailed got a 404. Tenancy is passed in —
  // proved by the share token for the customer, by the guard for the owner.
  const order = await getOrderForTenant(tenantId, orderId)
  if (!order) return null

  // `order` may or may not carry document_template_id and delivery_province depending on whether
  // add_orders_6 has been run. Read them off the record defensively rather than selecting them by
  // name, so an unmigrated database renders today's document instead of erroring.
  const extra = order as unknown as {
    documentTemplateId?: string | null; deliveryProvince?: string | null
    taxLabel?: string | null; taxRatePercent?: number | null
    pstExempt?: boolean; pstExemptionNote?: string | null
    invoiceImageId?: string | null
  }

  const [ctx, images, template, rates] = await Promise.all([
    loadDocContext(tenantId),
    // ForTenant, NOT the session-scoped variant: on /e/[token] that returned an empty array and the
    // customer's copy silently rendered with no photograph of the piece.
    publicDocumentImagesForTenant(tenantId, orderId),
    templateForOrder(tenantId, extra.documentTemplateId ?? null),
    loadTaxRates('CA'),
  ])

  const applied = applyTemplate(template, ctx.branding, ctx.business)

  // ── THE INVOICE PRINTS ONE PHOTO. THE ESTIMATE KEEPS THE GALLERY. ───────────────────────────────
  //
  // Uploads default to public because a photo the factory needs must not sit unseen, and the same
  // list has been feeding the customer's invoice — renders, a reference diagram, a competitor's
  // catalogue photo, all of it. An estimate is where reference material belongs and it is unchanged.
  //
  // Nothing chosen prints NO image, deliberately. There is no render/final distinction anywhere in
  // the data — it lives in the filename and in her head — so the alternative to "none" is not "the
  // right one", it is "whichever was uploaded first".
  const forInvoice = type === 'invoice'
  const chosen = forInvoice
    ? images.filter((i) => i.id === (extra.invoiceImageId ?? null))
    : images

  // Place of supply: the DELIVERY destination. Falling back to the seller's own province would be the
  // single most common Canadian tax error, and it is invisible on the document — the arithmetic looks
  // right, it is just the wrong rate. So there is deliberately NO fallback: no destination, no tax
  // line, and the owner is prompted to set one rather than being given a plausible wrong number.
  //
  // ── THE SNAPSHOT WINS ─────────────────────────────────────────────────────────────────────────
  //
  // What the seller CHOSE, not what the table says today. One province can mean two correct rates (a
  // BC sale is 12% retail and 5% wholesale for resale) and only the seller knows which sale it was —
  // so a live lookup could not pick between them even if the rates never changed. It also means
  // editing tax_rates next year cannot alter a document a customer already holds.
  //
  // The live lookup remains for orders raised before the picker existed. Those render exactly as they
  // did before, which is the whole reason nothing was backfilled.
  const snapshot = taxFromSnapshot(
    extra.deliveryProvince ?? null, extra.taxLabel ?? null, extra.taxRatePercent ?? null, order.subtotalCents)
  const tax = snapshot ?? taxOn(order.subtotalCents, rateFor(extra.deliveryProvince ?? null, rates))

  return {
    order,
    branding: applied.branding,
    business: applied.business,
    images: chosen,
    tax,
    // Only when the assertion was actually made. A note left behind after the box was unticked is not
    // a claim, and printing it would put an exemption on a document nobody stood behind.
    pstExemptionNote: extra.pstExempt ? (extra.pstExemptionNote?.trim() || null) : null,
    footerNote: applied.footerNote,
    templateName: applied.templateName,
  }
}
