import { describe, it, expect, afterEach } from 'vitest'
import {
  enforce, enforceAll, rateLimit, POLICIES, __setLimiterForTests, type PolicyName,
} from './ratelimit'

// Drives the real decision/response code paths with a deterministic injected limiter — no Redis,
// no network. Verifies limits, 429 shape, Retry-After, fail-open vs fail-closed, and multi-policy.

afterEach(() => {
  for (const k of Object.keys(POLICIES) as PolicyName[]) __setLimiterForTests(k, null)
})

const allow = async () => ({ success: true, reset: Date.now() + 1000 })
const block = (resetInMs: number) => async () => ({ success: false, reset: Date.now() + resetInMs })
const boom = async () => { throw new Error('redis down') }

describe('rateLimit decision', () => {
  it('allows under the limit', async () => {
    __setLimiterForTests('ai_amy', allow)
    expect((await rateLimit('ai_amy', 'tenant:x')).ok).toBe(true)
  })

  it('blocks over the limit and rounds Retry-After up', async () => {
    __setLimiterForTests('ai_amy', block(4200))
    const r = await rateLimit('ai_amy', 'tenant:x')
    expect(r.ok).toBe(false)
    expect(r.retryAfter).toBe(5) // ceil(4.2s)
  })

  it('never returns a Retry-After below 1s', async () => {
    __setLimiterForTests('ai_amy', async () => ({ success: false, reset: Date.now() - 1000 }))
    expect((await rateLimit('ai_amy', 't')).retryAfter).toBeGreaterThanOrEqual(1)
  })
})

describe('fail-safe on store error', () => {
  it('fails OPEN for a default policy (availability)', async () => {
    __setLimiterForTests('ai_amy', boom)
    expect((await rateLimit('ai_amy', 't')).ok).toBe(true)
  })

  it('fails CLOSED for the public unauthenticated AI policy (cost)', async () => {
    __setLimiterForTests('demo_public_ip', boom)
    const r = await rateLimit('demo_public_ip', 'ip:1')
    expect(r.ok).toBe(false)
    expect(r.retryAfter).toBe(60)
  })
})

describe('enforce() response contract', () => {
  it('returns null when allowed', async () => {
    __setLimiterForTests('ai_chat', allow)
    expect(await enforce('ai_chat', 'user:1')).toBeNull()
  })

  it('returns a 429 with Retry-After and a generic body that leaks nothing internal', async () => {
    __setLimiterForTests('ai_chat', block(3000))
    const res = await enforce('ai_chat', 'user:1')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(res!.headers.get('Retry-After')).toBe('3')
    const body = await res!.json()
    expect(body).toEqual({ error: 'Too many requests' })
    expect(JSON.stringify(body)).not.toMatch(/limit|remaining|window|reset|policy|redis|upstash/i)
  })
})

describe('enforceAll() layering', () => {
  it('stops at the first exceeded policy (IP allowed, slug blocked)', async () => {
    __setLimiterForTests('demo_public_ip', allow)
    __setLimiterForTests('demo_public_slug', block(2000))
    const res = await enforceAll([
      { policy: 'demo_public_ip', id: 'ip:1' },
      { policy: 'demo_public_slug', id: 'slug:x' },
    ])
    expect(res!.status).toBe(429)
  })

  it('passes when every layer allows', async () => {
    __setLimiterForTests('demo_public_ip', allow)
    __setLimiterForTests('demo_public_slug', allow)
    const res = await enforceAll([
      { policy: 'demo_public_ip', id: 'ip:1' },
      { policy: 'demo_public_slug', id: 'slug:x' },
    ])
    expect(res).toBeNull()
  })
})

describe('policy hygiene — no global one-size-fits-all limit', () => {
  it('uses varied limits/windows across surfaces', () => {
    const sigs = new Set(Object.values(POLICIES).map((p) => `${p.limit}/${p.window}`))
    expect(sigs.size).toBeGreaterThan(3)
  })

  it('public AI fails closed while authenticated defaults fail open', () => {
    expect(POLICIES.demo_public_ip.fail).toBe('closed')
    expect(POLICIES.demo_public_slug.fail).toBe('closed')
    expect(POLICIES.ai_amy.fail).toBe('open')
    expect(POLICIES.webhook.fail).toBe('open')
  })
})
