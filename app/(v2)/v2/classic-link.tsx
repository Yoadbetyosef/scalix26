'use client'

import { usePathname } from 'next/navigation'
import { CROSSINGS, crossingCookieValue, crossingLabelFor, type CrossingKey } from '@/lib/v2/crossing'

// THE ONE DOOR OUT OF /v2, AND IT SAYS SO ON ITS FACE.
//
// no-escape.test.ts forbids a ROW that quietly leaves the preview — a list item pointing at the old
// app is a dead end in one tap on a phone, and the guard has caught that three times. It does not
// forbid a control that announces where it goes. This is that control, and it is the only one: the
// guard now allows an href only when it carries `data-classic`, so a second door cannot be opened by
// adding a second exclusion.
//
// ── WHY IT IS THE SAME TAB ──────────────────────────────────────────────────────────────────────
//
// A new tab would remove the return problem rather than solve it, and it is what I would have chosen.
// The instruction is the same tab with a return pill, and that is defensible for a reason a new tab
// does not give you: somebody who crosses to create an order and lands two screens deep in v1 has a
// visible, named way back on every one of those screens, rather than a tab they have to remember is
// still open behind this one.
//
// What makes it work is that the marker is a COOKIE and not a query param — ?from= is dropped by the
// first redirect, which is exactly when the way back matters. See lib/v2/crossing.ts for the
// measurements.

export function ClassicLink({ to }: { to: CrossingKey }) {
  const from = usePathname()
  // The destination is a KEY, resolved here. No calling file ever contains a v1 URL, so the guard
  // needs no exemption beyond this one file — see CROSSINGS in lib/v2/crossing.ts.
  const { href, label, why } = CROSSINGS[to]

  return (
    <>
    <a
      // The marker the guard reads. Not decoration: no-escape allows an outbound href ONLY on an
      // element carrying it, so removing this attribute fails the build rather than quietly widening
      // the exception.
      data-classic
      className="v2-classic"
      href={href}
      onClick={() => {
        // Written synchronously, before the navigation request leaves — document.cookie is not async,
        // so there is no race with the browser starting the request.
        const label = crossingLabelFor(from)
        if (label) document.cookie = crossingCookieValue(from)
      }}
    >
      {label}
      {/* The marker, on the button's own face. A tooltip is a thing nobody reads before clicking. */}
      <i>Classic</i>
    </a>
    {/* A SIBLING, not a child: a button containing a paragraph stops being the same shape as the
        buttons beside it, which is what made the first version look like its own kind of control. */}
    {why && <span className="v2-classic-why">{why}</span>}
    </>
  )
}
