import { z } from 'zod'

// Request validation shared by POST /api/orders and PATCH /api/orders/[id]. Kept in one place so a new
// field can never be accepted on create but silently dropped on edit (or the reverse).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Dropdown values are free text on the wire: they're the tenant's own option labels, which she renames at
// will, so the server can't validate against a fixed enum. Length-capped only.
const optionLabel = z.string().max(200).nullable().optional()
const carat = z.number().min(0).max(10000).nullable().optional()

export const lineItemSchema = z.object({
  productName: z.string().min(1).max(300), description: z.string().max(2000).nullable().optional(), sku: z.string().max(100).nullable().optional(),
  quantity: z.number().min(0).max(100000).optional(), unitPriceCents: z.number().int().min(0).optional(),
  // INTERNAL ONLY. Nullable on purpose: null is "not recorded", 0 is "genuinely free", and the two
  // are different facts about margin.
  internalCostCents: z.number().int().min(0).nullable().optional(),
  measurements: z.string().max(500).nullable().optional(), color: z.string().max(200).nullable().optional(), material: z.string().max(200).nullable().optional(),
  customSpec: z.string().max(2000).nullable().optional(), productRef: z.string().uuid().nullable().optional(),
  stoneQuality: optionLabel, stoneColor: optionLabel, stoneOrigin: optionLabel, stoneType: optionLabel,
  centerStoneShape: optionLabel, sideStoneShape: optionLabel, metalKarat: optionLabel,
  certificateLab: optionLabel, ringSize: optionLabel,
  centerStoneCarat: carat, sideStoneCaratTotal: carat,
})

// Fields common to create and edit.
const orderFields = {
  contactId: z.string().uuid().nullable().optional(),
  customerName: z.string().max(300).nullable().optional(), customerEmail: z.string().email().max(320).nullable().optional(), customerPhone: z.string().max(50).nullable().optional(),
  factoryName: z.string().max(300).nullable().optional(), factoryContactName: z.string().max(300).nullable().optional(), factoryEmail: z.string().email().max(320).nullable().optional(),
  assignedEmployee: z.string().max(300).nullable().optional(), orderDate: date.nullable().optional(), requestedCompletionDate: date.nullable().optional(), estimatedCompletionDate: date.nullable().optional(),
  depositCents: z.number().int().min(0).optional(), currency: z.string().max(8).optional(),
  clientRequirements: z.string().max(20000).nullable().optional(), isCustomDesign: z.boolean().optional(),
  internalNotes: z.string().max(5000).nullable().optional(), publicNotes: z.string().max(5000).nullable().optional(),
  // Place of supply — the DESTINATION province, which decides the tax rate. Not the seller's.
  deliveryProvince: z.string().max(2).nullable().optional(),
  // WHICH RATE WAS CHARGED, as an id from TAX_CHOICES ('BC:combined', 'ON', …). An ID and never a
  // percentage: a client that could post its own rate could put 3% on a customer's invoice, and the
  // figure would look entirely ordinary. The server reads label, rate and province off the list.
  // Empty string clears the choice; absent leaves it alone.
  taxChoiceId: z.string().max(24).nullable().optional(),
  // The seller's ASSERTION that the provincial part does not apply, and the sentence that explains it.
  // Nothing validates a certificate and nothing should pretend to.
  pstExempt: z.boolean().optional(),
  pstExemptionNote: z.string().max(300).nullable().optional(),
  // The ONE attachment printed on the invoice. Null clears it and the invoice prints no image.
  invoiceImageId: z.string().uuid().nullable().optional(),
  // Which company's letterhead this order's documents use. Null = the tenant's default.
  documentTemplateId: z.string().uuid().nullable().optional(),
  // Which of the two letterhead DESIGNS. Not an enum on the wire even though it is one in the code:
  // asLetterheadStyle folds anything unrecognised back to the original design at render time, and a
  // 400 on a value we can draw around would be a document page that refuses to save.
  letterheadStyle: z.string().max(16).nullable().optional(),
  lineItems: z.array(lineItemSchema).max(200).optional(),
}

// On create the order number may be blank (auto-generated); on edit a blank would wipe a NOT NULL column.
export const createOrderSchema = z.object({ orderNumber: z.string().trim().max(50).optional(), ...orderFields })
export const patchOrderSchema = z.object({ orderNumber: z.string().trim().min(1).max(50).optional(), ...orderFields })
