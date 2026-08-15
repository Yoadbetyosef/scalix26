import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { v2Allowed, mainDomainUrl } from '@/lib/v2/access'
import './v2-tokens.css'

// The v2 preview tree.
//
// ── THIS LAYOUT MUST NOT RENDER <html> OR <body> ────────────────────────────────────────────────────
//
// It did, and that was a real fault. `app/layout.tsx` is the ROOT layout and already renders both; a
// route group does not escape it — escaping requires there to be NO app/layout.tsx at all, with every
// group owning its own root. So this layout NESTED a second <html><body></body></html> inside the
// first. Invalid markup, guaranteed hydration mismatch, and React responds to a mismatched root by
// discarding the server HTML and re-rendering the whole tree on the client. That is a strong
// candidate for the long blank stage, and it is a defect whether or not it is the whole story.
//
// ── globals.css DOES REACH THIS TREE, AND I CANNOT STOP IT ──────────────────────────────────────────
//
// Nothing here imports it. `app/layout.tsx` does, along with next/font's Inter, and every route in the
// app is inside that root layout. Preventing it would mean restructuring the app's root — outside the
// permitted files. Reported rather than worked around.
//
// What the scoping still guarantees: every v2 custom property is declared on `.v2` and every v2 rule
// is a `.v2` descendant, so v2 cannot leak OUT into the app, and v2's own rules beat globals' element
// selectors inside this subtree on specificity. What it does not guarantee is that globals' base and
// reset rules are absent — they apply.

// ── THE GATE ────────────────────────────────────────────────────────────────────────────────────
//
// The v2.* hostname was never a gate. proxy.ts REWRITES that host onto /v2 — the path resolves just
// the same on the main domain, so any signed-in user could type /v2/inbox and reach a tree that now
// sends messages to customers, stops follow-up sequences and marks leads booked.
//
// Here rather than in the middleware, for the reason the middleware itself gives about /admin: the
// check needs the ACTIVE TENANT, which means cookies plus two Supabase reads, and the edge cannot do
// that. app/admin/layout.tsx is the same four lines for the same reason.
//
// Here rather than in each page, because there are fifteen of them and listPageContext does not
// cover all fifteen — app/(v2)/v2/page.tsx does its own session work. One layout covers every page,
// its loading and error boundaries, and every page added after this one.
//
// TWO THINGS THIS DOES NOT DO, both deliberate:
//
//   1. A layout does not re-run on client-side navigation WITHIN /v2. Entering the tree from
//      anywhere outside it renders this, so there is no way in that skips it — but access revoked
//      mid-session survives until a reload. With an allowlist that only changes on deploy (which
//      restarts everything) that is not reachable in practice.
//   2. A layout does not cover route handlers. The two /v2-ONLY endpoints carry the same check
//      themselves; /send and /takeover deliberately do not, because v1 uses them.
//
// See lib/v2/access.ts for why the identity is the tenant, and for the sentence about this being an
// exposure boundary rather than an authorization one.

export const metadata = {
  title: 'Rudi — preview',
  robots: { index: false, follow: false },
}

export default async function V2Layout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Not signed in is the middleware's job and it has already run; this is only about WHO.
  if (user) {
    const tenantId = await getActiveTenantId()
    if (!v2Allowed(tenantId, user.email)) {
      const h = await headers()
      redirect(mainDomainUrl(h.get('x-forwarded-host') || h.get('host'), '/dashboard'))
    }
  }

  return (
    <div className="v2">
      {children}
      <div className="v2-grain" aria-hidden />
    </div>
  )
}
