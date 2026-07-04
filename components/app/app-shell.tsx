import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sidebar } from '@/components/dashboard/sidebar'

/**
 * The Scalix authenticated shell — the continuation of the /auth world inside the app.
 * A near-white canvas with a barely-visible purple/pink ambient wash, the calm sidebar,
 * and the page content. Presentation only: each route's layout keeps its own auth check
 * and simply wraps its children in this shell.
 */
export function AppShell({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) {
  return (
    <div className="relative flex min-h-screen bg-white">
      {/* Ambient atmosphere — barely there, behind everything. Wrapped in a fixed, viewport-sized,
          non-interactive layer that CLIPS the blobs on mobile so their off-screen overflow can
          never create horizontal document scroll. On desktop (sm+) the layer lets them overflow
          exactly as before, so the desktop look is unchanged. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden sm:overflow-visible">
        <div
          className="sx-drift-1 absolute -left-40 -top-40 h-[360px] w-[360px] rounded-full sm:h-[520px] sm:w-[520px]"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, #8e9bf0 8%, transparent), transparent 70%)' } as CSSProperties}
        />
        <div
          className="sx-drift-2 absolute -bottom-48 -right-40 h-[360px] w-[360px] rounded-full sm:h-[560px] sm:w-[560px]"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, #f0a9d6 7%, transparent), transparent 70%)' } as CSSProperties}
        />
      </div>

      <Sidebar />

      {/* min-w-0: a flex child defaults to min-width:auto and would expand to its content's
          min-content width (wider than the phone). This lets <main> shrink to the viewport so
          nothing gets pushed past the screen edge. */}
      <main className={cn('relative min-w-0 flex-1 pb-[72px] md:ml-16 md:pb-0 xl:ml-56', mainClassName)}>
        {children}
      </main>
    </div>
  )
}
