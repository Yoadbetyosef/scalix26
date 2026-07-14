import { describe, it, expect } from 'vitest'
import { hashToken, generateApprovalToken, tokensMatch, looksLikeToken } from './approval-token'

describe('Approval token security', () => {
  it('hashToken is deterministic SHA-256 hex and never returns the raw token', () => {
    const h = hashToken('abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashToken('abc'))
    expect(h).not.toContain('abc')
  })
  it('generateApprovalToken returns a URL-safe token with its matching hash; tokens are unique', () => {
    const { token, hash } = generateApprovalToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,64}$/) // base64url, no +/=
    expect(hash).toBe(hashToken(token))
    expect(generateApprovalToken().token).not.toBe(token)
  })
  it('tokensMatch only accepts the exact token (constant-time compare)', () => {
    const { token, hash } = generateApprovalToken()
    expect(tokensMatch(token, hash)).toBe(true)
    expect(tokensMatch(token + 'x', hash)).toBe(false)
    expect(tokensMatch('totally-wrong', hash)).toBe(false)
  })
  it('looksLikeToken pre-check rejects obvious garbage before any DB hit', () => {
    expect(looksLikeToken(generateApprovalToken().token)).toBe(true)
    expect(looksLikeToken('short')).toBe(false)
    expect(looksLikeToken('has spaces and !@#')).toBe(false)
    expect(looksLikeToken('')).toBe(false)
  })
})
