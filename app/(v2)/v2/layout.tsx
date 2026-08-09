import type { ReactNode } from 'react'
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

export const metadata = {
  title: 'Rudi — preview',
  robots: { index: false, follow: false },
}

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <div className="v2">
      {children}
      <div className="v2-grain" aria-hidden />
    </div>
  )
}
