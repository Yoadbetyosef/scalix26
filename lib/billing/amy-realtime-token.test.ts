import { describe, it, expect, afterEach, vi } from 'vitest'
import { mintAmyRealtimeToken, verifyAmyRealtimeToken } from './amy-realtime-token'

afterEach(() => vi.unstubAllEnvs())

describe('amy realtime token', () => {
  it('mints null and refuses to verify when no secret is configured (inert)', () => {
    expect(mintAmyRealtimeToken('t1')).toBeNull()
    expect(verifyAmyRealtimeToken('anything').ok).toBe(false)
    expect(verifyAmyRealtimeToken('anything').reason).toBe('no_secret')
  })

  it('round-trips a valid token for the same tenant', () => {
    vi.stubEnv('AMY_REALTIME_SECRET', 's3cret')
    const tok = mintAmyRealtimeToken('tenant-abc')!
    const v = verifyAmyRealtimeToken(tok)
    expect(v.ok).toBe(true)
    expect(v.tenantId).toBe('tenant-abc')
  })

  it('rejects a tampered payload (signature mismatch)', () => {
    vi.stubEnv('AMY_REALTIME_SECRET', 's3cret')
    const tok = mintAmyRealtimeToken('tenant-abc')!
    const [, sig] = tok.split('.')
    const forged = Buffer.from(JSON.stringify({ t: 'other-tenant', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64').replace(/=+$/, '')
    expect(verifyAmyRealtimeToken(`${forged}.${sig}`).ok).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    vi.stubEnv('AMY_REALTIME_SECRET', 'secret-A')
    const tok = mintAmyRealtimeToken('tenant-abc')!
    vi.stubEnv('AMY_REALTIME_SECRET', 'secret-B')
    expect(verifyAmyRealtimeToken(tok).reason).toBe('bad_sig')
  })

  it('rejects an expired token', () => {
    vi.stubEnv('AMY_REALTIME_SECRET', 's3cret')
    const past = Date.now() - 10 * 60 * 1000
    const tok = mintAmyRealtimeToken('tenant-abc', past)!
    expect(verifyAmyRealtimeToken(tok).reason).toBe('expired')
  })

  it('rejects malformed input', () => {
    vi.stubEnv('AMY_REALTIME_SECRET', 's3cret')
    expect(verifyAmyRealtimeToken(undefined).reason).toBe('malformed')
    expect(verifyAmyRealtimeToken('no-dot').reason).toBe('malformed')
  })
})
