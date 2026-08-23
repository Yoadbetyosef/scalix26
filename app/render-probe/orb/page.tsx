import { notFound } from 'next/navigation'
import { RudiPresenceProvider } from '@/components/dashboard/hero/rudi-presence'
import { RudiOrb } from '@/components/dashboard/hero/rudi-orb'

// The orb OUTSIDE the (v2) route group, which is the whole point of it.
//
// Its sibling under app/(v2)/v2/render-probe/orb loads v2-tokens.css, because everything in that
// group does. /dashboard does not. So that probe was answering "does he render with the v2
// stylesheet present", and the question that matters is "does he render without it" — the canvas
// carries classes (.v2-face, .v2-cards) whose rules simply are not there on a v1 page, and the
// positioning has to come from RudiOrb's own wrapper instead.
//
// Dev only, like the rest of the probe.

export const dynamic = 'force-dynamic'

export default function BareOrbProbe() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <RudiPresenceProvider>
      <div style={{ background: '#f6f7f9', minHeight: '100vh', padding: 24 }}>
        {[144, 112, 96].map((px) => (
          <div key={px} style={{ marginBottom: 24 }}>
            <p style={{ font: '500 11px ui-monospace, monospace', color: '#6b7280', margin: '0 0 8px' }}>{px}PX · NO v2 CSS</p>
            <div style={{ height: px, width: px }}>
              <RudiOrb />
            </div>
          </div>
        ))}
      </div>
    </RudiPresenceProvider>
  )
}
