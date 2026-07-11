// The ONE cron authenticator. Every scheduled/cron endpoint must gate on this — there are no
// public cron endpoints. FAIL-CLOSED by design, mirroring the webhook `shouldReject` philosophy:
//
//   • Deployed (Preview + Production both run NODE_ENV=production): require an exact
//     `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is missing or the header doesn't
//     match, REJECT. A missing secret must never fall open to a public job.
//   • Local dev only (`npm run dev`, NODE_ENV !== 'production'): bypass so crons are triggerable
//     without secrets. This never applies on Vercel.
//
// Vercel Cron auto-injects `Authorization: Bearer <CRON_SECRET>` on every scheduled invocation
// when CRON_SECRET is set, so the vercel.json crons authenticate through this same path. External
// schedulers (cron-job.org) send the same header. There is intentionally NO fallback secret and
// NO x-vercel-cron header trust — the shared secret is the single gate.
export function cronAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true // local dev only — never Preview/Production
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed: deployed with no configured secret rejects everything
  return req.headers.get('authorization') === `Bearer ${secret}`
}
