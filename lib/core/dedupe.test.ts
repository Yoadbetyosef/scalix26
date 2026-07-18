import { describe, it, expect } from 'vitest'
import { scoreDuplicate, findDuplicates, type DedupeCandidate } from './dedupe'

const c = (o: Partial<DedupeCandidate> & { id: string }): DedupeCandidate => ({ name: null, normalized_phone: null, normalized_email: null, ...o })

describe('scoreDuplicate', () => {
  it('same normalized phone → strong match', () => {
    expect(scoreDuplicate(c({ id: 'a', normalized_phone: '4155552671' }), c({ id: 'b', normalized_phone: '4155552671' }))).toMatchObject({ id: 'b', reasons: ['phone'] })
  })
  it('same email → strong match', () => {
    expect(scoreDuplicate(c({ id: 'a', normalized_email: 'x@y.com' }), c({ id: 'b', normalized_email: 'x@y.com' }))?.score).toBeGreaterThanOrEqual(0.7)
  })
  it('phone + name → higher than phone alone', () => {
    const both = scoreDuplicate(c({ id: 'a', normalized_phone: '1', name: 'Ari' }), c({ id: 'b', normalized_phone: '1', name: 'ari' }))!
    expect(both.score).toBeGreaterThan(0.7); expect(both.reasons).toContain('name')
  })
  it('no shared signal → null', () => expect(scoreDuplicate(c({ id: 'a', name: 'Ari' }), c({ id: 'b', name: 'Dana' }))).toBeNull())
  it('same id → null', () => expect(scoreDuplicate(c({ id: 'a', normalized_phone: '1' }), c({ id: 'a', normalized_phone: '1' }))).toBeNull())
})

describe('findDuplicates', () => {
  it('ranks by score and applies threshold', () => {
    const cand = c({ id: 'a', normalized_phone: '1', normalized_email: 'x@y.com', name: 'Ari' })
    const others = [c({ id: 'b', normalized_phone: '1', normalized_email: 'x@y.com' }), c({ id: 'c', name: 'Ari' }), c({ id: 'd', normalized_phone: '9' })]
    const found = findDuplicates(cand, others)
    expect(found[0].id).toBe('b')           // phone+email = strongest
    expect(found.map((m) => m.id)).not.toContain('c') // name-only 0.2 < 0.5 threshold
    expect(found.map((m) => m.id)).not.toContain('d') // no overlap
  })
})
