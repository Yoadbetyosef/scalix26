'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

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
// available. So that is all it CLAIMS about the cause — it never guesses.
//
// But it must SHOW what it was handed. It was printing the fact to the console and rendering a button,
// and framework errors carry an empty message and only a digest — so a real failure looked like a
// blank panel with "Try again" and nothing to search for. Every failure in /v2 looked identical, which
// is exactly how one of them stayed unexplained. Message when there is one, digest when there is not,
// and the path either way, so the reader knows WHICH screen and can find the entry in the logs.

export default function V2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname()
  useEffect(() => {
    console.error('[v2] render failed:', pathname, error)
  }, [error, pathname])

  // A framework error (notFound/redirect thrown where the router cannot catch it, a serialisation
  // failure) has no message at all — only a digest. Falling back to it is the difference between a
  // screen a reader can act on and one they cannot.
  const detail = error.message?.trim() || (error.digest ? `digest ${error.digest}` : 'No message was attached to the error.')

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
          <p style={{ fontFamily: 'var(--v2-mono)', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.42)', marginBottom: 10 }}>
            {pathname}
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.62)', marginBottom: 18, maxWidth: 460, overflowWrap: 'anywhere' }}>
            {detail}
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
