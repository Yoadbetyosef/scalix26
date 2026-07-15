import { NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─────────────────────────────────────────────────────────────────────────────
// Distributed rate limiting (Upstash Redis). Serverless-safe: NO in-memory counters —
// every counter lives in Redis so it's shared across all Vercel lambdas/regions.
//
// Design rules:
//   • No global one-size limit — each surface uses a named POLICY (see below).
//   • Keys are namespaced by deploy environment (rl:{env}:{policy}) so a Preview flood
//     can never consume a Production user's bucket, even if they share one Redis.
//   • FAIL-SAFE when the store is unavailable/unconfigured:
//       - default policies fail OPEN (allow) — a Redis outage must not lock out real users;
//       - cost-exposed PUBLIC policies fail CLOSED (deny) — a store outage must not become an
//         uncapped-spend hole on unauthenticated AI endpoints.
//   • Responses expose nothing internal: 429 + Retry-After + a generic body. No limit/
//     remaining/window/policy names are leaked to clients.
// ─────────────────────────────────────────────────────────────────────────────

type FailMode = 'open' | 'closed'
export interface Policy { limit: number; window: `${number} ${'s' | 'm' | 'h'}`; fail: FailMode }

// Named policies. Tuned per surface (see the Drop 3 inventory). Windows are Upstash Durations.
export const POLICIES = {
  // Auth-adjacent server routes (client-side Supabase auth is limited by Supabase itself).
  auth_signup:     { limit: 5,   window: '10 m', fail: 'open' },
  password_reset:  { limit: 5,   window: '15 m', fail: 'open' },
  invite_accept:   { limit: 10,  window: '10 m', fail: 'open' },
  invite_page:     { limit: 30,  window: '10 m', fail: 'open' },
  // Invitation management (partner-authed).
  invite_manage:   { limit: 60,  window: '1 m',  fail: 'open' },
  invite_email:    { limit: 10,  window: '10 m', fail: 'open' },
  // AI / cost-sensitive (authenticated → keyed by tenant/partner).
  ai_amy:          { limit: 20,  window: '1 m',  fail: 'open' },
  ai_chat:         { limit: 30,  window: '1 m',  fail: 'open' },
  ai_voice:        { limit: 30,  window: '1 m',  fail: 'open' },
  brain_run:       { limit: 10,  window: '1 h',  fail: 'open' },
  brain_read:      { limit: 30,  window: '1 m',  fail: 'open' },
  scan_website:    { limit: 10,  window: '1 h',  fail: 'open' },
  demo_generate:   { limit: 20,  window: '1 h',  fail: 'open' },
  coach_email:     { limit: 30,  window: '1 h',  fail: 'open' },
  convo_send:      { limit: 60,  window: '1 m',  fail: 'open' },
  // PUBLIC unauthenticated LLM — highest cost risk → fail CLOSED.
  demo_public_ip:  { limit: 15,  window: '1 m',  fail: 'closed' },
  demo_public_slug:{ limit: 40,  window: '1 h',  fail: 'closed' },
  // Admin manual WL platform-fee force-sync (super-admin, Preview-gated) — low volume, fail CLOSED.
  admin_platform_sync: { limit: 20, window: '1 m', fail: 'closed' },
  // CEO Command Center (founder-only) mutations — low volume, fail CLOSED.
  command_center: { limit: 60, window: '1 m', fail: 'closed' },
  // PUBLIC unauthenticated order-approval token page + response — fail CLOSED (abuse/enumeration guard).
  orders_approval: { limit: 40, window: '1 m', fail: 'closed' },
  // Webhooks: signature stays primary; this only caps floods. Generous so provider retries pass.
  webhook:         { limit: 240, window: '1 m',  fail: 'open' },
  webhook_stripe:  { limit: 600, window: '1 m',  fail: 'open' },
} as const satisfies Record<string, Policy>

export type PolicyName = keyof typeof POLICIES

const ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'

// Single shared Redis client (null when unconfigured → limiter disabled / fail-per-policy).
// Accept BOTH naming conventions: the classic @upstash vars AND the KV_REST_API_* names that the
// Vercel Upstash/Marketplace integration injects — otherwise the limiter silently stays disabled.
let redis: Redis | null = null
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
if (url && token) redis = new Redis({ url, token })

const limiters = new Map<PolicyName, Ratelimit>()
function limiterFor(name: PolicyName): Ratelimit | null {
  if (!redis) return null
  let rl = limiters.get(name)
  if (!rl) {
    const p = POLICIES[name]
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(p.limit, p.window),
      prefix: `rl:${ENV}:${name}`,
      analytics: false,
    })
    limiters.set(name, rl)
  }
  return rl
}

// Test seam: inject a deterministic limit fn per policy so automated tests exercise the real
// decision/response code paths without any Redis. Never used in production paths.
type LimitFn = (id: string) => Promise<{ success: boolean; reset: number }>
const testOverrides = new Map<PolicyName, LimitFn>()
export function __setLimiterForTests(name: PolicyName, fn: LimitFn | null) {
  if (fn) testOverrides.set(name, fn)
  else testOverrides.delete(name)
}

export interface RateResult { ok: boolean; retryAfter: number }

// Core check. identifier should already encode the identity dimension (ip:x / tenant:x / partner:x).
export async function rateLimit(name: PolicyName, identifier: string): Promise<RateResult> {
  const override = testOverrides.get(name)
  const p = POLICIES[name]
  try {
    let res: { success: boolean; reset: number }
    if (override) {
      res = await override(identifier)
    } else {
      const rl = limiterFor(name)
      if (!rl) return { ok: true, retryAfter: 0 } // unconfigured store → disabled (fail-open by default)
      const r = await rl.limit(identifier)
      res = { success: r.success, reset: r.reset }
    }
    if (res.success) return { ok: true, retryAfter: 0 }
    const retryAfter = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000))
    return { ok: false, retryAfter }
  } catch (err) {
    // Store error: honor the policy's fail mode. Open = allow (availability), closed = deny (cost).
    console.warn(`[ratelimit] store error on ${name}; failing ${p.fail}:`, err instanceof Error ? err.message : err)
    return p.fail === 'closed' ? { ok: false, retryAfter: 60 } : { ok: true, retryAfter: 0 }
  }
}

// Generic 429 — nothing internal leaked.
export function tooManyResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfter)) } },
  )
}

// Convenience: enforce one policy, returning a 429 response to short-circuit with, or null if allowed.
export async function enforce(name: PolicyName, identifier: string): Promise<NextResponse | null> {
  const r = await rateLimit(name, identifier)
  return r.ok ? null : tooManyResponse(r.retryAfter)
}

// Enforce several policies (e.g., per-IP AND per-tenant); returns the first 429 hit, else null.
export async function enforceAll(checks: Array<{ policy: PolicyName; id: string }>): Promise<NextResponse | null> {
  for (const c of checks) {
    const res = await enforce(c.policy, c.id)
    if (res) return res
  }
  return null
}

// Best-effort client IP from the Vercel/proxy chain.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || '0.0.0.0'
}
