import { z } from 'zod'

// The whole quote, as the editor holds it. One shape for create and for save.
export const quoteContentSchema = z.object({
  contactId: z.string().uuid().nullable(),
  clientName: z.string().max(200).nullable().optional(),
  ccEmails: z.array(z.string().max(200)).max(8).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().max(10000).nullable(),
  discountPercent: z.number().min(0).max(100).nullable(),
  lines: z.array(z.object({
    name: z.string().max(1000),
    detail: z.string().max(2000).nullable().optional(),
    imageUrl: z.string().url().max(2000).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    quantity: z.number().nonnegative().max(1_000_000),
    unitPriceCents: z.number().int().nonnegative().max(100_000_000_00),
  })).max(200),
})

export const QUOTE_ERR: Record<string, string> = {
  not_found: 'That quote no longer exists.',
  accepted: 'The customer has accepted this quote, so it is fixed. Make the invoice from it and change that instead.',
  contact_not_found: 'That customer could not be found.',
  failed: 'That could not be saved.',
}
