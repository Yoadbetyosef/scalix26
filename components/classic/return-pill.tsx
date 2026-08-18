'use client'

import { crossingCookieCleared, type Crossing } from '@/lib/v2/crossing'

// THE WAY BACK, ON EVERY CLASSIC SCREEN.
//
// Rendered by the root layout whenever the crossing cookie is set and the current path is not /v2.
// That is deliberately broad: somebody who crossed to create an order, was redirected to the new
// order, then clicked through to its document is three screens deep in a design they did not choose,
// and each of those screens carries the pill.
//
// ── IT NAMES THE SCREEN ─────────────────────────────────────────────────────────────────────────
//
// "Back to Appointments", not "Back". Two clicks into v1 the browser's own back button is a question
// — it goes to the previous v1 screen, not out — and a pill that only says "back" is the same
// question in different clothes. The cookie carries the /v2 path, so the pill can answer it.
//
// ── AND IT CLEARS ON THE WAY OUT ────────────────────────────────────────────────────────────────
//
// Clicking it clears the cookie before navigating, so the pill does not follow somebody who has
// returned and then wanders into a classic screen again for their own reasons. It also expires on its
// own after two hours, because a cookie that only clears on the happy path is a cookie that survives
// every unhappy one.

export function ReturnPill({ crossing }: { crossing: Crossing }) {
  return (
    <a
      className="classic-return"
      href={crossing.href}
      onClick={() => { document.cookie = crossingCookieCleared() }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back to {crossing.label}
    </a>
  )
}
