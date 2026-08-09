import type { ReactNode } from 'react'
import './v2-tokens.css'

// The v2 preview tree.
//
// This layout imports ./v2-tokens.css and NOTHING else. globals.css never enters this subtree, and
// v2-tokens.css declares every custom property on `.v2` rather than on `:root`, so neither design
// system can reach the other even if they later share a variable name.
//
// It is a route-group layout — app/(v2)/ — so it does not nest inside the app's own root layout's
// chrome. `.v2` is applied here, once, and every rule in the token file hangs off it.

export const metadata = {
  title: 'Rudi — preview',
  // Not indexable: this is a design preview served from v2.<domain>, not a product surface.
  robots: { index: false, follow: false },
}

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="v2">
          {children}
          <div className="v2-grain" aria-hidden />
        </div>
      </body>
    </html>
  )
}
