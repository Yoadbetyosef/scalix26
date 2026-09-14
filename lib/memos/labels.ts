// Re-exports for pages: the pure half of the memo module plus the one sentence a missing table
// needs. Kept out of store.ts so a client component can import labels without a server module.
export { MEMO_KIND_LABELS, isMemoSettled, memoOverdue, memoStatusLabel, canMemoTransition, MEMO_STATUSES } from './types'
export const MEMOS_MIGRATION_HINT = 'The memo workflow is not enabled on this account yet.'
