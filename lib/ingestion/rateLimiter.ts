// Per-domain politeness. One request per second to any single host, enforced by a token bucket keyed
// on hostname — NOT globally, so two tenants' sites crawl at full speed in parallel and neither waits
// on the other. A global limiter would make a 2,000-page crawl take 33 minutes of wall clock that
// every other tenant queues behind.

const DEFAULT_INTERVAL_MS = 1000

interface Bucket { nextAt: number; penaltyUntil: number }

export class DomainRateLimiter {
  private buckets = new Map<string, Bucket>()
  constructor(private intervalMs = DEFAULT_INTERVAL_MS) {}

  private key(url: string): string {
    try { return new URL(url).hostname.toLowerCase() } catch { return url }
  }

  // Wait until this host is allowed to be asked again, then reserve the next slot.
  async acquire(url: string, signal?: AbortSignal): Promise<void> {
    const k = this.key(url)
    const now = Date.now()
    const b = this.buckets.get(k) ?? { nextAt: 0, penaltyUntil: 0 }
    const readyAt = Math.max(b.nextAt, b.penaltyUntil, now)
    b.nextAt = readyAt + this.intervalMs
    this.buckets.set(k, b)
    const wait = readyAt - now
    if (wait > 0) await sleep(wait, signal)
  }

  // A 429 or 503 means our one-per-second guess was still too fast for this host. Back the whole
  // domain off, jittered so a fleet of workers doesn't retry in lockstep.
  penalize(url: string, attempt: number): number {
    const k = this.key(url)
    const b = this.buckets.get(k) ?? { nextAt: 0, penaltyUntil: 0 }
    const base = Math.min(30_000, this.intervalMs * 2 ** Math.max(0, attempt))
    const delay = Math.round(base * (0.5 + Math.random()))     // 50–150% jitter
    b.penaltyUntil = Date.now() + delay
    this.buckets.set(k, b)
    return delay
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
