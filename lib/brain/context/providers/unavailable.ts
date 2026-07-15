import type { ContextProvider } from '../types'

// Modules that have NO backing table in Scalix26 yet. Rather than silently omit them (which invites the model
// to invent), each explicitly declares the data unavailable when the customer asks. When these modules gain a
// real table, replace the stub with a fetching provider — no channel or prompt edits needed.
const stub = (key: string, label: string, keywords: string[], text: string): ContextProvider => ({
  key,
  label,
  keywords,
  async fetch() {
    return { available: false, text }
  },
})

export const unavailableProviders: ContextProvider[] = [
  stub('estimates', 'Estimates', ['estimate', 'estimates', 'quote', 'quotes', 'quotation'],
    'Estimates/quotes are not stored in the system. Do not quote a price unless it appears in the product catalog above.'),
  stub('reviews', 'Reviews', ['review', 'reviews', 'rating', 'ratings', 'testimonial', 'feedback'],
    'Customer reviews are not stored in the system and cannot be listed or quoted.'),
  stub('promotions', 'Promotions', ['promotion', 'promotions', 'promo', 'discount', 'discounts', 'coupon', 'coupons', 'sale', 'deal', 'offer code', 'voucher'],
    'There are no active promotions, discounts, or coupons in the system. Do not offer or imply any discount.'),
]
