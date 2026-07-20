// Proposal lifecycle statuses + edit-lock rules. Side-effect-free (safe to import from unit tests + client).
// draft → ready → sent → viewed → accepted/declined → (expired) → converted.
export const PROPOSAL_STATUSES = ['draft', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

// Accepted proposals are locked from ordinary editing; converted proposals are fully read-only.
export const LOCKED_STATUSES = ['accepted', 'converted']
export function editableFor(status: string): boolean { return !LOCKED_STATUSES.includes(status) }
export function lockReasonFor(status: string): string | null {
  if (status === 'converted') return 'This proposal was converted and is read-only. Duplicate it to make changes.'
  if (status === 'accepted') return 'This proposal was accepted and is locked. Duplicate it to make changes.'
  return null
}
