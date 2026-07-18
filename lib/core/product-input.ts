import { z } from 'zod'

// Typed Core product fields (the product spine, catalog_products). Pure/isomorphic — shared by the API
// route and unit tests. Base `price` is legacy DOLLARS (numeric(12,2)); variant/sales/payment money is
// integer cents elsewhere. Vertical fields (fabric, carat, …) are NOT here — they live in field_values.
export const PRODUCT_STATUSES = ['active', 'inactive', 'discontinued'] as const

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).nullish(),
  category: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  price: z.number().nonnegative().max(1_000_000_000).nullish(),
  status: z.enum(PRODUCT_STATUSES).default('active'),
  description: z.string().trim().max(5000).nullish(),
  image_url: z.string().trim().max(2000).nullish(),
})
export type ProductInput = z.infer<typeof productInputSchema>

// Partial variant for PATCH (edit General) — every field optional, but if `name` is present it must be non-empty.
export const productUpdateSchema = productInputSchema.partial()
export type ProductUpdate = z.infer<typeof productUpdateSchema>
