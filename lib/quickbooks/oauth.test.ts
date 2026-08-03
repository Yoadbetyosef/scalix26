import { describe, it, expect, beforeAll } from 'vitest'

// A fixed 32-byte key (64 hex) so the HMAC in state.ts is deterministic under test.
beforeAll(() => { process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64) })

describe('quickbooks oauth state (CSRF)', () => {
  it('round-trips the tenant id (and return target) for a fresh, untampered state', async () => {
    const { signState, verifyState } = await import('./state')
    const now = 1_000_000
    const s = signState('tenant-123', now)
    expect(verifyState(s, now + 5_000)).toEqual({ tenantId: 'tenant-123', ret: '' })
  })

  it('rejects a tampered payload', async () => {
    const { signState, verifyState } = await import('./state')
    const now = 1_000_000
    const s = signState('tenant-123', now)
    const [body, sig] = s.split('.')
    const forged = `${body}x.${sig}` // mutate the signed body
    expect(verifyState(forged, now)).toBeNull()
  })

  it('rejects an expired state (older than 10 min)', async () => {
    const { signState, verifyState } = await import('./state')
    const now = 1_000_000
    const s = signState('tenant-123', now)
    expect(verifyState(s, now + 11 * 60 * 1000)).toBeNull()
  })

  it('rejects malformed / empty state', async () => {
    const { verifyState } = await import('./state')
    expect(verifyState(null, 1)).toBeNull()
    expect(verifyState('', 1)).toBeNull()
    expect(verifyState('nodot', 1)).toBeNull()
  })
})

describe('quickbooks authorize url', () => {
  it('includes the required OAuth2 params and our state', async () => {
    const { authorizeUrl } = await import('./oauth')
    const url = authorizeUrl('THE_STATE')
    expect(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')).toBe(true)
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=com.intuit.quickbooks.accounting')
    expect(url).toContain('state=THE_STATE')
  })
})
