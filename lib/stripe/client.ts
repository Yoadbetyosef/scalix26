import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia' as const,
})

export const PLANS = {
  starter: {
    name: 'Starter',
    price: 97,
    priceId: process.env.STRIPE_STARTER_PRICE_ID!,
    features: ['1 AI Employee', '500 conversations/mo', 'SMS + Voice'],
    maxEmployees: 1,
    maxConversations: 500,
  },
  pro: {
    name: 'Pro',
    price: 197,
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    features: ['3 AI Employees', '2,000 conversations/mo', 'All channels'],
    maxEmployees: 3,
    maxConversations: 2000,
  },
  business: {
    name: 'Business',
    price: 397,
    priceId: process.env.STRIPE_BUSINESS_PRICE_ID!,
    features: ['Unlimited AI Employees', 'Unlimited conversations', 'Priority support'],
    maxEmployees: Infinity,
    maxConversations: Infinity,
  },
} as const
