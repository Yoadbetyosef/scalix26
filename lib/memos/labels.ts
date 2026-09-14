// Re-exports for pages: the pure half of the memo module plus the one sentence a missing table
// needs. Kept out of store.ts so a client component can import labels without a server module.
export { MEMO_KIND_LABELS, isMemoSettled, memoOverdue, memoStatusLabel, canMemoTransition, MEMO_STATUSES } from './types'
export const MEMOS_MIGRATION_HINT = 'Memos are not set up on this database yet — run add_tg_production_1.sql (part 4) in the Supabase SQL editor.'
