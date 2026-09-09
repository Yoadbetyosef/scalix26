import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

// A LINK LIVES UNTIL IT IS REVOKED. NOTHING ELSE ENDS ONE.
//
// ── THE FAULT, AS THE PRODUCTION DATA RECORDED IT ───────────────────────────────────────────────
//
// Two approval links for TG jewellers, sent 2026-09-09 at 01:26 and 01:27 UTC — 18:26 and 18:27 in
// Vancouver — both carrying expires_at 2026-09-08T23:59:59Z. That instant is 16:59:59 local, so both
// were dead 87 minutes before they were sent. `opened_at` is null on both: her customer's first and
// only click landed on "Link unavailable".
//
// The cause was `new Date(deadline + 'T23:59:59Z')` — a local calendar date read as a UTC instant —
// on a value that was also being used as a hard kill switch. Two separate mistakes compounding: the
// wrong zone, and a deadline doing a job a deadline should never do.
//
// These assertions are source-level on purpose. The behaviour they protect is the ABSENCE of code —
// no expiry check, no expires_at write — and absence is not something a unit test of a function can
// observe. A grep is the right shape of instrument for "this must not come back".

const read = (f: string) => readFileSync(f, 'utf8')
/** Comments stripped: these files explain the bug at length, and the explanation must not fail. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const APPROVALS = 'lib/orders/approvals.ts'
const SHARES = 'lib/orders/shares.ts'

describe('nothing expires a link any more', () => {
  it('the default expiry constant is gone from the approvals engine', () => {
    // It was 14 days. A link with no deadline died a fortnight after it was sent, which is the same
    // bug with a longer fuse and no reason at all behind the number.
    expect(code(APPROVALS)).not.toMatch(/DEFAULT_EXPIRY_DAYS/)
  })

  it('no code path writes expires_at', () => {
    // The column stays (old rows hold values) but nothing may set it. An `expires_at:` key in an
    // insert or update payload is the fault returning.
    for (const f of [APPROVALS, SHARES]) {
      expect(code(f), `${f} writes expires_at`).not.toMatch(/expires_at\s*:/)
    }
  })

  it('no code path turns expires_at into a refusal', () => {
    // The specific shape that killed the links: reading the column and comparing it to now.
    expect(code(APPROVALS)).not.toMatch(/isExpired/)
    for (const f of [APPROVALS, SHARES]) {
      expect(code(f), `${f} still selects expires_at for a decision`).not.toMatch(/expires_at.*<.*Date|Date.*expires_at.*getTime/)
    }
  })

  it('the deadline is resolved in a real timezone, not stamped as UTC', () => {
    // The literal that caused it. Any reappearance of a bare 'T23:59:59Z' concatenation is the bug.
    expect(code(APPROVALS)).not.toMatch(/T23:59:59Z/)
    expect(code(APPROVALS)).toMatch(/endOfDayUtc/)
    expect(code(APPROVALS)).toMatch(/getBusinessTimezone/)
  })
})

describe('revocation is reachable', () => {
  it('shares can be revoked from code', () => {
    // `revoked_at` existed on order_document_shares from the day the table was created and nothing
    // ever wrote it — the link could not be killed at all. Removing the expiry without this would
    // have made that permanent rather than merely long.
    expect(code(SHARES)).toMatch(/revoked_at:\s*new Date/)
    expect(code(SHARES)).toMatch(/export async function revokeShare/)
  })

  it('both revoke routes exist', () => {
    expect(read('app/api/orders/[id]/shares/[shareId]/route.ts')).toMatch(/export async function DELETE/)
    expect(read('app/api/orders/[id]/approvals/[requestId]/route.ts')).toMatch(/export async function DELETE/)
  })

  it('a screen actually calls them', () => {
    // The approval revoke ROUTE has existed all along with nothing wired to it, which is the same as
    // not existing. This asserts the panel calls both.
    const panel = code('components/orders/shared-links.tsx')
    expect(panel).toMatch(/\/shares\/\$\{id\}/)
    expect(panel).toMatch(/\/approvals\/\$\{id\}/)
    expect(panel).toMatch(/method: 'DELETE'/)
  })

  it('revoking is one-way', () => {
    // The update is guarded on revoked_at being null, so a second revoke is a no-op rather than a
    // refreshed timestamp, and nothing anywhere clears the column.
    expect(code(SHARES)).toMatch(/\.is\('revoked_at', null\)/)
    expect(code(SHARES)).not.toMatch(/revoked_at:\s*null/)
  })
})

describe('a dead link that is HELD by its recipient explains itself', () => {
  it('the approval page distinguishes withdrawn from unknown', () => {
    const page = code('app/approval/[token]/page.tsx')
    expect(page).toMatch(/deadLinkReason/)
    // The old copy named three causes at once and left the reader guessing.
    expect(read('app/approval/[token]/page.tsx')).not.toMatch(/is invalid, has expired, or is no longer available/)
  })

  it('the shared-document page distinguishes withdrawn from unknown', () => {
    expect(code('app/e/[token]/page.tsx')).toMatch(/shareLinkRevoked/)
  })

  it('an unknown token still learns nothing', () => {
    // The reason lookup returns null for a token that matches no row, and for a draft — a draft was
    // never sent, so its recipient is not a recipient, and its existence is the one fact that must
    // not leak.
    const src = code('lib/orders/approvals.ts')
    const from = src.indexOf('export async function deadLinkReason')
    // Bounded at the NEXT export, or the slice runs to the end of the file and reads every other
    // function's strings as if they were this one's.
    const fn = src.slice(from, src.indexOf('export ', from + 10))
    expect(fn).toMatch(/if \(!r\) return null/)
    expect(fn).not.toMatch(/'draft'/)
  })
})
