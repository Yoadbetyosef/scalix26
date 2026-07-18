import { describe, it, expect } from 'vitest'
import { isTransitionAllowed, type Edge } from './workflow'

const edges: Edge[] = [
  { from: null, to: 'new' },        // entry
  { from: 'new', to: 'in_progress' },
  { from: 'in_progress', to: 'done' },
  { from: 'in_progress', to: 'cancelled' },
]

describe('isTransitionAllowed', () => {
  it('allows the entry edge from a null current stage', () => expect(isTransitionAllowed(null, 'new', edges)).toBe(true))
  it('allows a defined forward edge', () => expect(isTransitionAllowed('new', 'in_progress', edges)).toBe(true))
  it('rejects an undefined edge (skipping stages)', () => expect(isTransitionAllowed('new', 'done', edges)).toBe(false))
  it('rejects a backward edge that was not defined', () => expect(isTransitionAllowed('done', 'in_progress', edges)).toBe(false))
  it('allows branching to a failed/cancelled stage', () => expect(isTransitionAllowed('in_progress', 'cancelled', edges)).toBe(true))
})
