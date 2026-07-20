import { describe, it, expect } from 'vitest'
import { proposalTotals } from './money'
import { hashToken, generateProposalToken, tokensMatch, looksLikeToken } from './proposal-token'
import { proposalEmailHtml } from './proposal-email'
import { PROPOSAL_STATUSES, editableFor, lockReasonFor } from './proposal-status'

describe('proposalTotals (line discounts + overall discount + document tax)', () => {
  const lines = [{ quantity: 2, unit_price_cents: 5000, discount_cents: 0 }, { quantity: 1, unit_price_cents: 3000, discount_cents: 500 }]
  it('subtotal is Σ gross, ignoring discounts', () => expect(proposalTotals(lines, 0, 0).subtotal_cents).toBe(13000))
  it('discount = Σ line discounts + overall', () => expect(proposalTotals(lines, 1000, 0).discount_cents).toBe(1500))
  it('total = max(0, subtotal − discount) + tax', () => expect(proposalTotals(lines, 1000, 800).total_cents).toBe(13000 - 1500 + 800))
  it('never negative when discount exceeds subtotal', () => expect(proposalTotals(lines, 999999, 0).total_cents).toBe(0))
  it('tax still applies on a fully-discounted doc', () => expect(proposalTotals(lines, 999999, 700).total_cents).toBe(700))
})

describe('proposal public token', () => {
  it('hashToken is deterministic', () => expect(hashToken('abc')).toBe(hashToken('abc')))
  it('generate produces a matching hash and NOT the raw token', () => { const { token, hash } = generateProposalToken(); expect(hash).toBe(hashToken(token)); expect(hash).not.toBe(token); expect(tokensMatch(token, hash)).toBe(true) })
  it('a wrong token does not match', () => { const { hash } = generateProposalToken(); expect(tokensMatch('not-the-token-xxxxxxxxxxxxxxxxxxxxxxxxxx', hash)).toBe(false) })
  it('looksLikeToken accepts generated tokens, rejects junk', () => { const { token } = generateProposalToken(); expect(looksLikeToken(token)).toBe(true); expect(looksLikeToken('short')).toBe(false); expect(looksLikeToken('has spaces!!')).toBe(false) })
})

describe('branded proposal email', () => {
  const html = proposalEmailHtml({ businessName: 'Design Co', customerName: 'Dana', proposalNumber: 'PROP-0001', summary: 'Two sofas', thumbnails: ['https://x/a.jpg'], totalFormatted: '$1,300.00', expiresOn: '2026-09-01', link: 'https://x/proposals/tok', supportEmail: 'hi@design.co' })
  it('includes business name, number, total, expiry and the secure link', () => { for (const s of ['Design Co', 'PROP-0001', '$1,300.00', '2026-09-01', 'https://x/proposals/tok', 'View proposal']) expect(html).toContain(s) })
  it('escapes HTML in tenant-provided fields', () => { const evil = proposalEmailHtml({ businessName: '<script>x</script>', customerName: null, proposalNumber: 'P1', summary: null, thumbnails: [], totalFormatted: '$0', expiresOn: null, link: 'https://x', supportEmail: null }); expect(evil).not.toContain('<script>x</script>'); expect(evil).toContain('&lt;script&gt;') })
})

describe('proposal lifecycle statuses', () => {
  it('covers the full lifecycle', () => expect([...PROPOSAL_STATUSES]).toEqual(['draft', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted']))
})

describe('proposal edit locks (version safety)', () => {
  it('draft/ready/sent/viewed/declined/expired are editable', () => { for (const s of ['draft', 'ready', 'sent', 'viewed', 'declined', 'expired']) expect(editableFor(s)).toBe(true) })
  it('accepted + converted are locked', () => { expect(editableFor('accepted')).toBe(false); expect(editableFor('converted')).toBe(false) })
  it('lock reasons are specific and only for locked statuses', () => {
    expect(lockReasonFor('converted')).toMatch(/read-only/i)
    expect(lockReasonFor('accepted')).toMatch(/locked/i)
    expect(lockReasonFor('draft')).toBeNull()
    expect(lockReasonFor('sent')).toBeNull()
  })
})
