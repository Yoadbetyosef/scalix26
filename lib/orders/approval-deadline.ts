// A DEADLINE IS A REQUEST. IT IS NOT A LOCK.
//
// ── WHAT THIS FILE EXISTS TO UNDO ───────────────────────────────────────────────────────────────
//
// `createAndSendApproval` used to turn the deadline Tatiana picks in a date box into the token's
// `expires_at`, and `getApprovalByToken` returned null past it — which the page renders as a 404.
// So a soft request ("please respond by Friday") was silently also a hard kill switch on the link,
// and the customer who came back on Saturday was told the link was invalid.
//
// It was computed as `new Date(deadline + 'T23:59:59Z')`: her LOCAL calendar date stamped as a UTC
// instant. Every tenant west of Greenwich therefore got a deadline that ended early — for Vancouver,
// seven hours early, which lands before lunchtime on the day itself. Two of her approval links went
// out at 18:26 and 18:27 local on 8 Sep 2026 with an expiry of 16:59:59 that same afternoon. They
// were dead 87 minutes before she pressed send, `opened_at` on both is null, and the customer's first
// and only click got the unavailable page.
//
// Expiry is gone (see approvals.ts). This file remains because the deadline is still SHOWN, and a
// deadline shown a day early is its own smaller version of the same bug.
//
// ── WHY NOT A LIBRARY ───────────────────────────────────────────────────────────────────────────
//
// date-fns-tz or luxon would each do this in one call, and neither is a dependency of this project.
// The whole job is "what UTC instant is the end of this calendar day in this zone", which Intl
// already knows; adding a package for it would be a new dependency in a repository that has been
// careful not to accumulate them.

/**
 * How far `tz` is from UTC at a given instant, in minutes. Positive east of Greenwich.
 *
 * Intl will format an instant into a zone's wall-clock parts but will not hand back the offset, so
 * the parts are re-assembled as though they were UTC and the difference IS the offset. This is the
 * standard trick and it is exact for every zone Intl supports, including the half-hour and
 * three-quarter-hour ones (Kolkata, Kathmandu, Chatham) that a fixed table gets wrong.
 */
function offsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // `hour` comes back as 24 rather than 0 for midnight under hour12:false in some runtimes.
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return (asIfUtc - instant.getTime()) / 60_000
}

/**
 * The last instant of a calendar day in a given zone, as an ISO UTC string.
 *
 * ── THE SECOND PASS IS NOT DECORATION ───────────────────────────────────────────────────────────
 *
 * The offset is a function of the instant, and the instant is what we are solving for. The first
 * pass uses the offset at the wrong moment (the naive UTC reading of the local wall time) and lands
 * within an hour of the answer; the second re-reads the offset at THAT instant and corrects it.
 * Two passes settle every case a DST boundary can produce, because a transition moves the clock by
 * at most an hour or two and the first pass is never further out than the offset itself.
 *
 * Returns null for a malformed date or an unknown zone rather than guessing — the caller stores no
 * deadline at all in that case, which is the honest outcome and no longer a dangerous one now that
 * a missing deadline cannot kill a link.
 */
export function endOfDayUtc(date: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  // Real calendar dates only: '2026-02-31' parses under the regex and must not become 3 March.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null

  const naive = Date.UTC(y, m - 1, d, 23, 59, 59)
  try {
    const first = naive - offsetMinutes(new Date(naive), tz) * 60_000
    const second = naive - offsetMinutes(new Date(first), tz) * 60_000
    const out = new Date(second)
    if (Number.isNaN(out.getTime())) return null
    // Round-trip guard: the local calendar day of the answer must be the day we were asked for. This
    // catches the one case two passes cannot — a date that does not exist in the zone at all.
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(out)
    return back === date ? out.toISOString() : null
  } catch {
    // An invalid IANA zone. Intl throws rather than returning anything, and a thrown deadline must
    // not take the whole send with it.
    return null
  }
}
