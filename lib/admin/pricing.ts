// Monthly plan prices (USD). Single source for MRR/ARR/revenue across the admin platform.
export const PLAN_PRICE: Record<string, number> = { starter: 297, pro: 397, business: 597 }
export const planPrice = (plan?: string | null): number => (plan ? PLAN_PRICE[plan] || 0 : 0)
export const PAID_PLANS = Object.keys(PLAN_PRICE)
