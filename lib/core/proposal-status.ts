// Proposal lifecycle statuses. Side-effect-free (safe to import from unit tests + client code).
// draft → ready → sent → viewed → accepted/declined → (expired) → converted.
export const PROPOSAL_STATUSES = ['draft', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]
