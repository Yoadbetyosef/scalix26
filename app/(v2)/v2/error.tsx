'use client'

import { useEffect } from 'react'

// The boundary for this screen.
//
// ── IT SAYS ONLY WHAT IT KNOWS ──────────────────────────────────────────────────────────────────────
//
// It used to say "Rudi could not load today's numbers." That was a guess, and on its first real
// firing it was WRONG: the numbers had loaded perfectly and the failure was a TypeError in an effect.
// A boundary that names a cause it cannot see sends the reader hunting in the wrong place — the same
// false-artefact shape as a record claiming a review that never happened, or a meter implying it can
// hear you.
//
// An error boundary knows exactly two things: that rendering this screen failed, and that a retry is
// available. So that is all it claims. What actually broke goes to the console, where it is useful.

export default function V2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The boundary shows a sentence; the console gets the fact. Without this the only symptom is a
    // panel of prose, and the next failure is diagnosed by guesswork.
    console.error('[v2] render failed:', error)
  }, [error])

  return (
    <div className="v2-app">
      <main
        className="v2-stage v2-stage-loading"
        style={{ gridColumn: '1 / -1', display: 'grid', placeItems: 'center' }}
      >
        <div style={{ textAlign: 'center', color: '#fff', padding: 24 }}>
          <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
            Something went wrong rendering this screen.
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 18 }}>
            The details are in the browser console.
          </p>
          <button
            type="button"
            onClick={reset}
            className="v2-talk"
            style={{ position: 'static', display: 'inline-flex' }}
          >
            <span className="v2-lab">Try again</span>
          </button>
        </div>
      </main>
    </div>
  )
}
