// Business tags admins can apply. Pure constant so both the API route and client can share it.
export const ALLOWED_TAGS = ['VIP', 'Needs Support', 'Beta Customer', 'Enterprise', 'Priority'] as const
export type BusinessTag = (typeof ALLOWED_TAGS)[number]
