import { loadDocContext } from './documents'
import { publicDocumentImagesForTenant } from './attachments'
import { templateForOrder, applyTemplate } from './templates'
import { getOrderForTenant } from './store'
import { loadTaxRates } from '@/lib/tax/rates-store'
import { rateFor, taxOn, type TaxLine } from '@/lib/tax/canada'
import type { OrderWithDetails } from './types'
import type { DocBranding, DocBusiness } from './documents'
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
  footerNote: string | null
  templateName: string | null
}

export async function loadOrderDocument(
  tenantId: string,
  orderId: string,
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
  const extra = order as unknown as { documentTemplateId?: string | null; deliveryProvince?: string | null }

  const [ctx, images, template, rates] = await Promise.all([
    loadDocContext(tenantId),
    // ForTenant, NOT the session-scoped variant: on /e/[token] that returned an empty array and the
    // customer's copy silently rendered with no photograph of the piece.
    publicDocumentImagesForTenant(tenantId, orderId),
    templateForOrder(tenantId, extra.documentTemplateId ?? null),
    loadTaxRates('CA'),
  ])

  const applied = applyTemplate(template, ctx.branding, ctx.business)

  // Place of supply: the DELIVERY destination. Falling back to the seller's own province would be the
  // single most common Canadian tax error, and it is invisible on the document — the arithmetic looks
  // right, it is just the wrong rate. So there is deliberately NO fallback: no destination, no tax
  // line, and the owner is prompted to set one rather than being given a plausible wrong number.
  const rate = rateFor(extra.deliveryProvince ?? null, rates)
  const tax = taxOn(order.subtotalCents, rate)

  return {
    order,
    branding: applied.branding,
    business: applied.business,
    images,
    tax,
    footerNote: applied.footerNote,
    templateName: applied.templateName,
  }
}
