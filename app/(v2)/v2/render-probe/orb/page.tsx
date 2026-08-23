import { notFound } from 'next/navigation'
import { RudiPresenceProvider } from '@/components/dashboard/hero/rudi-presence'
import { RudiOrb } from '@/components/dashboard/hero/rudi-orb'

// The orb at the three sizes the dashboard actually renders it, on the dashboard's own ground rather
// than the v2 shell's — so what is measured here is what a customer would see.
//
// Dev only, like its parent. See ../page.tsx for why this exists at all.

export const dynamic = 'force-dynamic'

const SIZES = [
  { px: 144, where: 'mobile centrepiece — h-36 w-36' },
  { px: 112, where: 'desktop sm: — h-28 w-28' },
  { px: 96, where: 'desktop base — h-24 w-24' },
]

export default function OrbProbe() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <RudiPresenceProvider>
      <div style={{ background: '#f6f7f9', minHeight: '100vh', padding: 24, fontFamily: 'system-ui' }}>
        {SIZES.map((s) => (
          <div key={s.px} style={{ marginBottom: 28 }}>
            <p style={{ font: '500 11px/1 ui-monospace, monospace', color: '#6b7280', letterSpacing: '.08em', margin: '0 0 10px' }}>
              {s.px}PX · {s.where.toUpperCase()}
            </p>
            <div style={{ height: s.px, width: s.px }} data-orb={s.px}>
              <RudiOrb />
            </div>
          </div>
        ))}
      </div>
    </RudiPresenceProvider>
  )
}
